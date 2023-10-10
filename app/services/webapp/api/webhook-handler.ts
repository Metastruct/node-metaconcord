import { GameBridge } from "../../gamebridge";
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

const BaseEmbed = <Discord.WebhookMessageCreateOptions>{
	allowedMentions: { parse: ["users"] },
};

const GetGithubChanges = (
	added: string[],
	removed: string[],
	modified: string[],
	repoPath: string,
	sha: string
): string[] => {
	return [
		...added.map(
			s => `Add [${s}](https://github.com/${repoPath}/blob/${sha}/${s.replace(" ", "%%20")})`
		),
		...removed.map(
			s => `Del [${s}](https://github.com/${repoPath}/blob/${sha}/${s.replace(" ", "%%20")})`
		),
		...modified.map(
			s => `Mod [${s}](https://github.com/${repoPath}/blob/${sha}/${s.replace(" ", "%%20")})`
		),
	];
};

const getGitHubDiff = async (url: string) => {
	const res = await axios.get<string>(url + ".diff");
	if (res) return res.data;
};

const FIELD_REGEX = /^(?:Add|Mod|Del) \[(.+)\]/g;

const SERVER_EMOJI_MAP = {
	"1": "1️⃣",
	"2": "2️⃣",
	"3": "3️⃣",
};

export default (webApp: WebApp): void => {
	webApp.app.use(createNodeMiddleware(GitHub, { path: "/webhooks/github" }));
	let webhook: Discord.Webhook;
	let bridge: GameBridge;

	const bot = webApp.container.getService("DiscordBot");
	if (!bot) return;

	bot.discord.on("ready", async () => {
		const bridgeService = webApp.container.getService("GameBridge");
		if (!bridgeService) return;
		bridge = bridgeService;

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
		}
	});

	bot.discord.on("interactionCreate", async (ctx: Discord.ButtonInteraction) => {
		if (!ctx.member || !ctx.isButton() || !bridge) return;
		const [action, override] = ctx.customId.split("_");
		const where = override !== undefined ? override.split(",") : ["1", "2", "3"]; // how tf do I tell typescript that 'override' can be undefined

		const allowed = (<Discord.GuildMemberRoleManager>ctx.member.roles).cache.some(
			x => x.id === bot.config.roles.developer || x.id === bot.config.roles.administrator
		);

		if (!allowed) return;

		switch (action) {
			case "update":
				await ctx.reply(`<@${ctx.user.id}> updating ${where.map(s => `#${s}`).join()}...`);
				await Promise.all(
					sshConfig.servers
						.filter((srvConfig: { host: string; username: string; port: number }) =>
							where.includes(srvConfig.host.slice(1, 2))
						)
						.map(
							async (srvConfig: { host: string; username: string; port: number }) => {
								const ssh = new NodeSSH();

								await ssh.connect({
									username: srvConfig.username,
									host: srvConfig.host,
									port: srvConfig.port,
									privateKeyPath: sshConfig.keyPath,
								});

								await ssh
									.exec("gserv", ["qu", "rehash"], {
										stream: "stderr",
									})
									.then(async () =>
										(
											await ctx.fetchReply()
										).react(
											SERVER_EMOJI_MAP[srvConfig.host.slice(1, 2)] ?? "❓"
										)
									);
							}
						)
				)
					.then(() => {
						ctx.editReply(`<@${ctx.user.id}> successfully updated all servers!`);
					})
					.catch(err => {
						ctx.editReply(`<@${ctx.user.id}> failed to update :(\`\`\`\n${err}\`\`\``);
					});
				break;
			case "everything":
				//await ctx.update({ components: [] });
				await ctx.reply(
					`<@${ctx.user.id}> updating and refreshing files on ${where
						.map(s => `#${s}`)
						.join()}...`
				);
				await Promise.all(
					sshConfig.servers
						.filter((srvConfig: { host: string; username: string; port: number }) =>
							where.includes(srvConfig.host.slice(1, 2))
						)
						.map(
							async (srvConfig: { host: string; username: string; port: number }) => {
								const ssh = new NodeSSH();
								const reply = await ctx.fetchReply();

								if (!bridge.servers) {
									throw new Error(
										"no servers connected, please try again in a sec."
									);
								}

								const gameServer =
									bridge.servers[Number(srvConfig.host.slice(1, 2))];
								if (!gameServer) throw new Error("gameserver not connected?");

								await ssh.connect({
									username: srvConfig.username,
									host: srvConfig.host,
									port: srvConfig.port,
									privateKeyPath: sshConfig.keyPath,
								});

								await ssh
									.exec("gserv", ["qu", "rehash"], {
										stream: "stderr",
									})
									.then(async () => {
										const channel = <Discord.TextBasedChannel>(
											await gameServer.discord.channels.fetch(reply.channelId)
										);
										(await channel.messages.fetch(reply)).react("📥");
									});

								const msg = ctx.message;
								const files = msg.embeds
									.flatMap(e => e.fields)
									.map(f => [...f.value.matchAll(FIELD_REGEX)].map(m => m[1])[0]);
								const res = await bridge.payloads.RconPayload.callLua(
									'if not RefreshLua then return false, "RefreshLua missing?" end\n' +
										files
											.filter(f => f.split(".")[1] === "lua")
											.map(f => `RefreshLua([[${f}]])`)
											.join("\n"),
									"sv",
									gameServer,
									ctx.user.globalName ?? ctx.user.displayName
								);
								if (res) {
									const channel = <Discord.TextBasedChannel>(
										await gameServer.discord.channels.fetch(reply.channelId)
									);

									(await channel.messages.fetch(reply)).react("🔁");
								}
								return res;
							}
						)
				)
					.then(() => {
						ctx.editReply(
							`<@${ctx.user.id}> successfully updated all servers and refreshed files!`
						);
					})
					.catch(err =>
						ctx.editReply(`<@${ctx.user.id}> failed to update :(\`\`\`\n${err}\`\`\``)
					);
				break;
		}
	});

	const REPO_SERVER_MAP: [repo: string, servers: number[]][] = [
		["terrortown_modding", [3]],
		["MTA-Gamemode", [3]],
	];

	GitHub.on("push", async event => {
		const payload = event.payload;
		const repo = payload.repository;
		const serverOverride = REPO_SERVER_MAP.find(r => r[0] === repo.name)?.[1];
		const commits = payload.commits;
		const branch = payload.ref.split("/")[2];

		const embeds: Discord.APIEmbed[] = [];

		for (const commit of commits) {
			const fields: Discord.APIEmbedField[] = [];
			const changes = GetGithubChanges(
				commit.added,
				commit.removed,
				commit.modified,
				repo.full_name,
				payload.ref
			);
			const isPullRequestMerge = commit.message.startsWith("Merge pull request");

			for (let i = 0; i < changes.length; i++) {
				const change = changes[i];
				fields.push({
					name: i > 0 ? "​" : "---",
					value: change.length > 1024 ? "<LINK TOO LONG>" : change,
				});
			}

			let diff = isPullRequestMerge ? undefined : await getGitHubDiff(commit.url);
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
						branch !== repo.default_branch
							? (repo.name + "/" + branch).substring(0, 256)
							: repo.name.substring(0, 256),
					url: repo.url,
					icon_url: repo.owner.avatar_url,
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
		const messagePayload = <Discord.WebhookMessageCreateOptions>{
			...BaseEmbed,
			username: payload.sender.name ?? payload.sender.login,
			avatarURL: payload.sender.avatar_url,
			content: payload.forced
				? "<a:ALERTA:843518761160015933> Force Pushed <a:ALERTA:843518761160015933>"
				: "",
			embeds: embeds,
		};
		const components = <Discord.APIActionRowComponent<Discord.APIMessageActionRowComponent>>{
			components: [
				{
					type: Discord.ComponentType.Button,
					custom_id: serverOverride ? `update_${serverOverride.join()}` : "update",
					label: serverOverride
						? `Update Files on ${serverOverride.map(s => `#${s}`).join()}`
						: "Update Files on all Servers",
					style: 1,
				},
				{
					type: Discord.ComponentType.Button,
					custom_id: serverOverride
						? `everything_${serverOverride.join()}`
						: "everything",
					label: serverOverride
						? `Update and Refresh Files on ${serverOverride.map(s => `#${s}`).join()}`
						: `Update and Refresh Files on all Servers`,
					style: 1,
				},
			],
			type: Discord.ComponentType.ActionRow,
		};

		// todo: figure out a good way to keep the embed size below the maximum size of 6000
		if (embeds.length > 1) {
			for (let i = 0; i < embeds.length; i += 1) {
				const chunk = embeds.slice(i, i + 1);
				webhook.send({
					...messagePayload,
					embeds: chunk,
					components:
						i === embeds.length && repo.language === "Lua" ? [components] : undefined,
				});
			}
		} else {
			webhook.send({
				...messagePayload,
				components: repo.language === "Lua" ? [components] : undefined,
			});
		}
	});

	GitHub.on("organization", async event => {
		const payload = event.payload;

		let title: string | undefined;
		let description: string | undefined;
		let timestamp: string | undefined = new Date().toISOString();
		let thumbnail: Discord.APIEmbedThumbnail | undefined;

		switch (payload.action) {
			case "member_invited":
				title = "member invited";
				description = `[${payload.invitation.inviter.login}](${payload.invitation.inviter.url}) invited [${payload.user.login}](${payload.user.url}) as \`${payload.invitation.role}\``;
				thumbnail = {
					url: payload.user.avatar_url,
				};
				timestamp = payload.invitation.created_at;
				break;
			case "member_added":
				title = "member joined";
				description = `[${payload.membership.user.login}](${payload.membership.user.url}) joined ${payload.organization.login} as \`${payload.membership.role}\``;
				thumbnail = {
					url: payload.membership.user.avatar_url,
				};
				break;
			case "member_removed":
				title = "member removed";
				description = `[${payload.membership.user.login}](${payload.membership.user.url}) left ${payload.organization.login}`;
				thumbnail = {
					url: payload.membership.user.avatar_url,
				};
				break;
			case "renamed":
				title = "renamed organisation";
				description = `${payload.changes.login.from} -> ${payload.organization.login}`;
				break;
			case "deleted":
				title = `deleted organisation ${payload.organization.login}`;
				break;
			default:
				title = "unknown organisation action???";
				break;
		}

		const messagePayload = <Discord.WebhookMessageCreateOptions>{
			...BaseEmbed,
			username: payload.sender.name ?? payload.sender.login,
			avatarURL: payload.sender.avatar_url,
			embeds: [
				{
					author: {
						name: payload.organization.login,
						url: payload.organization.url,
						icon_url: payload.organization.avatar_url,
					},
					thumbnail: thumbnail,
					title: title,
					description: description,
					timestamp: timestamp,
				},
			],
		};

		webhook.send(messagePayload);
	});

	GitHub.on("membership", async event => {
		const payload = event.payload;

		const messagePayload = <Discord.WebhookMessageCreateOptions>{
			...BaseEmbed,
			username: payload.sender.name ?? payload.sender.login,
			avatarURL: payload.sender.avatar_url,
			embeds: [
				{
					author: {
						name: payload.organization.login,
						url: payload.organization.url,
						icon_url: payload.organization.avatar_url,
					},
					thumbnail: {
						url: payload.member.avatar_url,
					},
					title: "Membership " + event.payload.action,
					description: `[${payload.sender.login}](${payload.sender.url}) ${event.payload.action} [${payload.member.login}](${payload.member.url}) to ${payload.team.name}`,
					timestamp: new Date().toISOString(),
				},
			],
		};

		webhook.send(messagePayload);
	});

	GitHub.on("team", async event => {
		const payload = event.payload;

		let title: string | undefined;
		let description: string | undefined;
		switch (event.payload.action) {
			case "added_to_repository":
				title = "team added to repository";
				description = `[${payload.sender.login}](${payload.sender.url}) added [${payload.team.name}](${payload.team.url}) to [${payload.repository?.name}](${payload.repository?.url})`;
				break;
			case "removed_from_repository":
				title = "team removed from repository";
				description = `[${payload.sender.login}](${payload.sender.url}) removed [${payload.team.name}](${payload.team.url}) from [${payload.repository?.name}](${payload.repository?.url})`;
				break;
			case "created":
				title = "team created";
				description = `[${payload.sender.login}](${payload.sender.url}) created [${payload.team.name}](${payload.team.url})`;
			case "deleted":
				title = "team deleted";
				description = `[${payload.sender.login}](${payload.sender.url}) deleted [${payload.team.name}](${payload.team.url})`;
			case "edited":
				title = "team edited";
				description = `[${payload.sender.login}](${payload.sender.url}) edited [${payload.team.name}](${payload.team.url})`;
			default:
				title = "unknown team action???";
				break;
		}

		const messagePayload: Discord.WebhookMessageCreateOptions = {
			...BaseEmbed,
			username: payload.sender.name ?? payload.sender.login,
			avatarURL: payload.sender.avatar_url,
			embeds: [
				{
					author: {
						name: payload.organization.login,
						url: payload.organization.url,
						icon_url: payload.organization.avatar_url,
					},
					title: title,
					description: description,
					timestamp: new Date().toISOString(),
				},
			],
		};

		webhook.send(messagePayload);
	});
};
