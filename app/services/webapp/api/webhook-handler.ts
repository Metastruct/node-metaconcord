import { NodeSSH } from "node-ssh";
import { WebApp } from "..";
import { Webhooks, createNodeMiddleware } from "@octokit/webhooks";
import { clamp } from "@/utils";
import Discord from "discord.js";
import axios from "axios";
import sshConfig from "@/config/ssh.json";
import webhookConfig from "@/config/webhooks.json";

const COLOR_MOD = 75;
const COLOR_BASE = 50;

const GitHub = new Webhooks({
	secret: webhookConfig.github.secret,
});

// todo: maybe there is a better way for this?
// const PublicCommits = new Discord.WebhookClient({
// 	url: webhookConfig.webhookUrls.public.commits,
// });
// const PrivateCommits = new Discord.WebhookClient({
// 	url: webhookConfig.webhookUrls.private.commits,
// });
// const MappingCommits = new Discord.WebhookClient({
// 	url: webhookConfig.webhookUrls.public.mapping,
// });
// const TestCommits = new Discord.WebhookClient({
// 	url: webhookConfig.webhookUrls.private.test,
// });

const BaseEmbed = {
	allowedMentions: { parse: ["users"] },
} as Discord.WebhookMessageCreateOptions;

const GetGithubChanges = (
	added: string[],
	removed: string[],
	modified: string[],
	repoPath: string,
	sha: string
): string[] => {
	// behold, the most cursed thing known to mankind
	return [].concat.apply(
		[],
		[
			added.map(
				s =>
					`Add [${s}](https://github.com/${repoPath}/blob/${sha}/${s.replace(
						" ",
						"%%20"
					)})`
			),
			removed.map(
				s =>
					`Del [${s}](https://github.com/${repoPath}/blob/${sha}/${s.replace(
						" ",
						"%%20"
					)})`
			),
			modified.map(
				s =>
					`Mod [${s}](https://github.com/${repoPath}/blob/${sha}/${s.replace(
						" ",
						"%%20"
					)})`
			),
		]
	);
};

const getGitHubDiff = async (url: string) => {
	const res = await axios.get<string>(url + ".diff");
	if (res) return res.data;
};

const FIELD_REGEX = /^(?:Add|Mod|Del) \[(.+)\]/g;

export default (webApp: WebApp): void => {
	webApp.app.use(createNodeMiddleware(GitHub, { path: "/webhooks/github" }));
	let webhook: Discord.Webhook;

	const bot = webApp.container.getService("DiscordBot");
	if (!bot) return;

	bot.discord.on("ready", async () => {
		const bridge = webApp.container.getService("GameBridge");
		if (!bridge) return;

		const channel = bot.getTextChannel(bot.config.channels.publicCommits);
		if (channel) {
			const hooks = await channel.fetchWebhooks();
			const botHook = hooks.filter(h => h.owner === bot.discord.user).first();
			if (!botHook) {
				webhook = await channel.createWebhook({
					name: "Public Commits",
					reason: "Webhook missing?",
				});
			} else {
				webhook = botHook;
			}

			const collector = channel.createMessageComponentCollector({
				componentType: Discord.ComponentType.Button,
				time: 3600000,
			});

			collector.on("collect", async (ctx: Discord.ButtonInteraction) => {
				if (!ctx.member) return;
				const action = ctx.customId;

				const allowed = (ctx.member.roles as Discord.GuildMemberRoleManager).resolveId(
					bot.config.roles.developer
				);

				if (!allowed) return;

				switch (action) {
					case "update":
						//await ctx.update({ components: [] });
						await ctx.reply(`<@${ctx.user.id}> updating servers...`);
						await Promise.all(
							sshConfig.servers.map(
								async (srvConfig: {
									host: string;
									username: string;
									port: number;
								}) => {
									const ssh = new NodeSSH();

									await ssh.connect({
										username: srvConfig.username,
										host: srvConfig.host,
										port: srvConfig.port,
										privateKeyPath: sshConfig.keyPath,
									});

									await ssh.exec("gserv", ["qu", "rehash"], {
										stream: "stderr",
									});
								}
							)
						)
							.then(() => {
								ctx.editReply(
									`<@${ctx.user.id}> successfully updated all servers!`
								);
							})
							.catch(err => {
								ctx.editReply(
									`<@${ctx.user.id}> failed to update :(\`\`\`\n${err}\`\`\``
								);
							});
						break;
					case "everything":
						//await ctx.update({ components: [] });
						await ctx.reply(`<@${ctx.user.id}> updating servers and files...`);
						await Promise.all(
							sshConfig.servers.map(
								async (srvConfig: {
									host: string;
									username: string;
									port: number;
								}) => {
									const ssh = new NodeSSH();

									await ssh.connect({
										username: srvConfig.username,
										host: srvConfig.host,
										port: srvConfig.port,
										privateKeyPath: sshConfig.keyPath,
									});

									await ssh.exec("gserv", ["qu", "rehash"], {
										stream: "stderr",
									});
								}
							)
						)
							.then(async () => {
								const msg = ctx.message;
								const files = msg.embeds
									.flatMap(e => e.fields)
									.map(f => [...f.value.matchAll(FIELD_REGEX)].map(m => m[1])[0]);

								await Promise.all(
									bridge.servers.map(server =>
										bridge.payloads.RconPayload.callLua(
											files.map(f => `RefreshLua([[${f}]])`).join("\n"),
											"sv",
											server,
											ctx.user.globalName ?? ctx.user.displayName
										)
									)
								)
									.then(data => {
										console.log(JSON.stringify(data, undefined, 2));
										const errors = data.flatMap(res => res.data.errors);
										ctx.editReply(
											`<@${ctx.user.id}> updated servers and refreshed files sucessfully!`
										);
									})
									.catch(err => {
										ctx.editReply(
											`<@${ctx.user.id}> could not refresh files. :(\`\`\`\n${err}\`\`\``
										);
									});
							})
							.catch(err => {
								ctx.editReply(
									`<@${ctx.user.id}> failed to update servers :(\`\`\`\n${err}\`\`\``
								);
							});
						break;
				}
			});
		}
	});

	GitHub.on("push", async event => {
		const embeds: Discord.APIEmbed[] = [];
		const fields: Discord.APIEmbedField[] = [];
		const commits = event.payload.commits;
		const branch = event.payload.ref.split("/")[2];

		for (const commit of commits) {
			const changes = GetGithubChanges(
				commit.added,
				commit.removed,
				commit.modified,
				event.payload.repository.full_name,
				event.payload.ref
			);

			for (let i = 0; i < changes.length; i++) {
				const change = changes[i];
				fields.push({
					name: i > 0 ? "​" : "---",
					value: change.length > 1024 ? "<LINK TOO LONG>" : change,
				});
			}

			let diff = await getGitHubDiff(commit.url);
			if (diff) {
				diff = diff.replace(/(@@ -\d+,\d+ .+\d+,\d+ @@)[^\n]/g, "$1\n");
				diff = diff.replace(/diff.+\nindex.+\n/g, "");
				diff = diff.replace("`", "​`");
			}

			embeds.push({
				title:
					commit.message.length > 256
						? `${commit.message.substring(0, 250)}. . .`
						: commit.message,
				description: diff
					? `\`\`\`diff\n${
							diff.length > 4096 - 12 ? diff.substring(0, 4079) + ". . ." : diff
					  }\`\`\``
					: undefined,
				author: {
					name:
						branch !== event.payload.repository.default_branch
							? (event.payload.repository.name + "/" + branch).substring(0, 256)
							: event.payload.repository.name.substring(0, 256),
					url: event.payload.repository.url,
					icon_url: event.payload.repository.owner.avatar_url,
				},
				color:
					clamp(COLOR_BASE + COLOR_MOD * commit.removed.length, COLOR_BASE, 255) * 65536 +
					clamp(COLOR_BASE + COLOR_MOD * commit.added.length, COLOR_BASE, 255) * 256 +
					clamp(COLOR_BASE + COLOR_MOD * commit.modified.length, COLOR_BASE, 255),
				url: commit.url,
				fields: fields,
				timestamp: commit.timestamp,
				footer: {
					text: `${commit.id.substring(0, 6)} by ${
						commit.author.username ?? commit.author.name
					}${
						commit.author.name !== commit.committer.name
							? ` via ${commit.committer.username ?? commit.committer.name}`
							: ""
					}`,
				},
			});
		}
		const payload = {
			...BaseEmbed,
			username: event.payload.sender.name ?? event.payload.sender.login,
			avatarURL: event.payload.sender.avatar_url,
			content: event.payload.forced
				? "<a:ALERTA:843518761160015933> Force Pushed <a:ALERTA:843518761160015933>"
				: "",
			embeds: embeds,
		};
		const components = {
			components: [
				{
					type: Discord.ComponentType.Button,
					custom_id: "update",
					label: "Update Server",
					style: 1,
				},
				{
					type: Discord.ComponentType.Button,
					custom_id: "everything",
					label: "Update Server and Refresh Files",
					style: 1,
				},
			],
			type: Discord.ComponentType.ActionRow,
		} as Discord.APIActionRowComponent<Discord.APIMessageActionRowComponent>;

		if (embeds.length > 10) {
			for (let i = 0; i < embeds.length; i += 10) {
				const chunk = embeds.slice(i, i + 10);
				webhook.send({
					...payload,
					embeds: chunk,
					components:
						i === embeds.length && event.payload.repository.language === "Lua"
							? [components]
							: undefined,
				});
			}
		} else {
			webhook.send({
				...payload,
				components: event.payload.repository.language === "Lua" ? [components] : undefined,
			});
		}
	});
};
