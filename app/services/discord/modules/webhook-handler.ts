import * as Discord from "discord.js";
import { DiscordBot } from "../index.js";
import { Webhooks, createNodeMiddleware } from "@octokit/webhooks";
import { clamp } from "@/utils.js";
import axios from "axios";
import webhookConfig from "@/config/webhooks.json" with { type: "json" };

const COLOR_MOD = 75;
const COLOR_BASE = 50;

const MAX_COMMITS = 5;

const MinimalPushUsers = ["MetaAutomator"];

const GitHub = new Webhooks({
	secret: webhookConfig.github.secret,
});

const CreateOptions = <Discord.WebhookMessageCreateOptions>{
	allowedMentions: { parse: ["users"] },
};

const GetGithubChanges = (
	repoPath: string,
	sha: string,
	added: string[] = [],
	removed: string[] = [],
	modified: string[] = []
): string[] => {
	return [
		...added.map(
			s =>
				`Add [${s}](https://github.com/${repoPath}/blob/${sha}/${s.replaceAll(
					" ",
					"%%20"
				)})`
		),
		...removed.map(
			s =>
				`Del [${s}](https://github.com/${repoPath}/blob/${sha}/${s.replaceAll(
					" ",
					"%%20"
				)})`
		),
		...modified.map(
			s =>
				`Mod [${s}](https://github.com/${repoPath}/blob/${sha}/${s.replaceAll(
					" ",
					"%%20"
				)})`
		),
	];
};

const getGitHubDiff = async (url: string) => {
	try {
		const res = await axios.get<string>(url + ".diff");
		if (res)
			return res.data
				.replaceAll(/(@@ -\d+,\d+ .+\d+,\d+ @@)[^\n]/g, "$1\n")
				.replaceAll(/diff.+\nindex.+\n/g, "")
				.replaceAll("```", "​`​`​`");
	} catch {}
};

const FIELD_REGEX = /^(?:Add|Mod|Del) \[(.+)\]/g;

const SERVER_EMOJI_MAP = {
	"1": "1️⃣",
	"2": "2️⃣",
	"3": "3️⃣",
};

const REPO_SERVER_MAP = new Map([
	["Lumiens-Map-Vote", [3]],
	["MTA-Gamemode", [3]],
	["terrortown_modding", [3]],
	["ttt_player_tumbler", [3]],
	["ttt_ragmod", [3]],
	["TTT2", [3]],
]);

const isRemoteMergeCommit = (message: string) =>
	message.startsWith("Merge remote-tracking") || message.startsWith("Merge pull request");
const isMergeCommit = (message: string) =>
	message.startsWith("Merge branch") || isRemoteMergeCommit(message);

export default async (bot: DiscordBot): Promise<void> => {
	const webapp = await bot.container.getService("WebApp");

	const middleware = createNodeMiddleware(GitHub, { path: "/" });

	webapp.app.use("/webhooks/github", async (req, res, next) => {
		if (await middleware(req, res, next)) return;
		res.status(404).end();
	});

	let webhook: Discord.Webhook;
	const bridge = bot.bridge;

	bot.discord.on("ready", async () => {
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
		const where =
			override !== undefined
				? bridge.servers.filter(s => override.split(",").includes(s.config.id.toString()))
				: bridge.servers.filter(s => !!s.config.ssh);

		const allowed = (<Discord.GuildMemberRoleManager>ctx.member.roles).cache.some(
			x => x.id === bot.config.roles.developer || x.id === bot.config.roles.administrator
		);

		if (!allowed) return;

		switch (action) {
			case "update":
				await ctx.reply(
					`<@${ctx.user.id}> updating ${where
						.map(s =>
							s.discord.ready ? `<@${s.discord.user?.id}>` : `#${s.config.id}`
						)
						.join()}...`
				);
				await Promise.all(
					where.map(async server => {
						await server
							.sshExec("gserv", ["qu", "rehash"], {
								stream: "stderr",
							})
							.then(async () =>
								(await ctx.fetchReply()).react(
									SERVER_EMOJI_MAP[server.config.id] ?? "❓"
								)
							);
					})
				)
					.then(() => {
						if (!bridge) return;
						ctx.editReply(
							`<@${ctx.user.id}> successfully updated ${
								where.length === bridge.servers.length - 1 // 0 = empty
									? "all servers"
									: where
											.map(s =>
												s.discord.ready
													? `<@${s.discord.user?.id}>`
													: `#${s.config.id}`
											)
											.join()
							}!`
						);
					})
					.catch(err => {
						ctx.editReply(
							`<@${ctx.user.id}> something went wrong :(\`\`\`\n${err}\`\`\``
						);
						console.error(err);
					});
				break;
			case "everything":
				//await ctx.update({ components: [] });
				await ctx.reply(
					`<@${ctx.user.id}> updating and refreshing files on ${where
						.map(s =>
							s.discord.ready ? `<@${s.discord.user?.id}>` : `#${s.config.id}`
						)
						.join()}...`
				);
				await Promise.all(
					where.map(async server => {
						const reply = await ctx.fetchReply();

						await server
							.sshExec("gserv", ["qu", "rehash"], {
								stream: "stderr",
							})
							.then(async () => {
								const channel = <Discord.TextBasedChannel>(
									await server.discord.channels.fetch(reply.channelId)
								);
								(await channel.messages.fetch(reply)).react("📥");
							});

						const msg = ctx.message;
						const files = msg.embeds
							.flatMap(e => e.fields)
							.map(f => [...f.value.matchAll(FIELD_REGEX)].map(m => m[1])[0]);
						const res = await server.sendLua(
							'if not RefreshLua then return false, "RefreshLua missing?" end\n' +
								files
									.filter(f => f && f.split(".")[1] === "lua")
									.map(f => `RefreshLua([[${f}]])`)
									.join("\n"),
							"sv",
							ctx.user.globalName ?? ctx.user.displayName
						);
						if (res) {
							const channel = <Discord.TextBasedChannel>(
								await server.discord.channels.fetch(reply.channelId)
							);

							(await channel.messages.fetch(reply)).react("🔁");
						}
						return res;
					})
				)
					.then(() => {
						if (!bridge) return;
						ctx.editReply(
							`<@${ctx.user.id}> successfully updated ${
								where.length === bridge.servers.length - 1 // 0 = empty
									? "all servers"
									: where
											.map(s =>
												s.discord.ready
													? `<@${s.discord.user?.id}>`
													: `#${s.config.id}`
											)
											.join()
							} and refreshed files!`
						);
					})
					.catch(err => {
						ctx.editReply(
							`<@${ctx.user.id}> something went wrong :(\`\`\`\n${err}\`\`\``
						);
						console.error(err);
					});
				break;
		}
	});

	GitHub.on("push", async event => {
		if (!webhook) return;
		const payload = event.payload;
		const repo = payload.repository;
		const serverOverride = REPO_SERVER_MAP.get(repo.name);
		const commits = payload.commits;
		const branch = payload.ref.split("/")[2];

		let includesLua = false;

		const components: Discord.Component[] = [];

		if (payload.head_commit && isRemoteMergeCommit(payload.head_commit.message))
			commits.splice(0, commits.length, payload.head_commit);

		if (commits.length > MAX_COMMITS) {
			components.push(<Discord.ContainerComponent>{
				type: Discord.ComponentType.Container,
				accentColor: 0xffd700,
				components: [
					{
						type: Discord.ComponentType.Section,
						accessory: {
							type: Discord.ComponentType.Thumbnail,
							media: {
								url: repo.owner?.avatar_url,
							},
							description: repo.name + " avatar",
						},
						components: [
							{
								type: Discord.ComponentType.TextDisplay,
								content: `## [${
									branch !== repo.default_branch
										? repo.name + "/" + branch
										: repo.name
								}](${repo.html_url})\n\n# ${commits.length} commits in this push`,
							},
							{
								type: Discord.ComponentType.TextDisplay,
								content: `[View all changes](${payload.compare})`,
							},
							{
								type: Discord.ComponentType.TextDisplay,
								content: `-# by ${payload.sender?.name ?? payload.sender?.login ?? "unkown"}`,
							},
						],
					},
				],
			});
		} else {
			for (const commit of commits) {
				//const fields: Discord.APIEmbedField[] = [];
				const changes = GetGithubChanges(
					repo.full_name,
					payload.ref,
					commit.added,
					commit.removed,
					commit.modified
				);

				includesLua =
					commit.added?.some(str => str.endsWith(".lua")) ||
					commit.modified?.some(str => str.endsWith(".lua")) ||
					commit.removed?.some(str => str.endsWith(".lua")) ||
					false;

				const links = changes.join("\n");

				const diff = isMergeCommit(commit.message)
					? undefined
					: await getGitHubDiff(commit.url);

				const color =
					clamp(COLOR_BASE + COLOR_MOD * (commit.removed?.length ?? 0), COLOR_BASE, 255) *
						65536 +
					clamp(COLOR_BASE + COLOR_MOD * (commit.added?.length ?? 0), COLOR_BASE, 255) *
						256 +
					clamp(COLOR_BASE + COLOR_MOD * (commit.modified?.length ?? 0), COLOR_BASE, 255);

				if (MinimalPushUsers.includes(commit.author.username ?? commit.author.name)) {
					components.push(<Discord.ContainerComponent>{
						type: Discord.ComponentType.Container,
						accentColor: color,
						components: [
							{
								type: Discord.ComponentType.TextDisplay,
								content: `### [${
									branch !== repo.default_branch
										? repo.name + "/" + branch
										: repo.name
								}](${repo.html_url})\n\n## [${commit.message}](${commit.url})`,
							},
							{
								type: Discord.ComponentType.TextDisplay,
								content: `[${changes.length} files changed.](${payload.compare}`,
							},
							{
								type: Discord.ComponentType.TextDisplay,
								content: `-# ${commit.id.substring(0, 6)} by ${commit.author.username ?? commit.author.name}${
									commit.author.name !== commit.committer.name
										? ` via ${commit.committer.username ?? commit.committer.name}`
										: ""
								}`,
							},
						],
					});
					continue;
				}

				components.push(<Discord.ContainerComponent>{
					type: Discord.ComponentType.Container,
					accentColor: color,
					components: [
						{
							type: Discord.ComponentType.Section,
							accessory: {
								type: Discord.ComponentType.Thumbnail,
								media: {
									url: repo.owner?.avatar_url,
								},
								description: repo.name + " avatar",
							},
							components: [
								{
									type: Discord.ComponentType.TextDisplay,
									content: `## [${
										branch !== repo.default_branch
											? repo.name + "/" + branch
											: repo.name
									}](${repo.html_url})\n\n# [${commit.message}](${commit.url})`,
								},
								{ type: Discord.ComponentType.TextDisplay, content: diff },
								{
									type: Discord.ComponentType.Separator,
									divider: true,
									spacing: 2,
								},
								{
									type: Discord.ComponentType.TextDisplay,
									content: links,
								},
								{
									type: Discord.ComponentType.TextDisplay,
									content: `-# ${commit.id.substring(0, 6)} by ${commit.author.username ?? commit.author.name}${
										commit.author.name !== commit.committer.name
											? ` via ${commit.committer.username ?? commit.committer.name}`
											: ""
									}`,
								},
							],
						},
					],
				});
			}
		}

		const messagePayload = <Discord.WebhookMessageCreateOptions>{
			...CreateOptions,
			username: payload.sender?.name ?? payload.sender?.login ?? "unknown",
			avatarURL: payload.sender?.avatar_url,
			components: [
				payload.forced
					? {
							type: Discord.ComponentType.TextDisplay,
							content:
								"<a:ALERTA:843518761160015933> Force Pushed <a:ALERTA:843518761160015933>",
						}
					: undefined,
				...components,
			],
		};

		const buttons = <Discord.ActionRow<Discord.MessageActionRowComponent>>{
			type: Discord.ComponentType.ActionRow,
			components: [
				{
					type: Discord.ComponentType.Button,
					customId: serverOverride ? `update_${serverOverride.join()}` : "update",
					label: serverOverride
						? `Update Files on ${serverOverride.map(s => `#${s}`).join()}`
						: "Update Files on all Servers",
					style: 1,
				},
				{
					type: Discord.ComponentType.Button,
					customId: serverOverride ? `everything_${serverOverride.join()}` : "everything",
					label: serverOverride
						? `Update and Refresh Files on ${serverOverride.map(s => `#${s}`).join()}`
						: `Update and Refresh Files on all Servers`,
					style: 1,
				},
			],
		};

		// todo: figure out a good way to keep the embed size below the maximum size of 6000
		if (components.length > 1) {
			for (let i = 0; i < components.length; i++) {
				const chunk = components.slice(i, i + 1);
				webhook.send({
					...messagePayload,
					components:
						i === components.length && includesLua
							? [...components, buttons]
							: components,
					flags: Discord.MessageFlags.IsComponentsV2,
				});
			}
		} else {
			webhook
				.send({
					...messagePayload,
					components: components,
					flags: Discord.MessageFlags.IsComponentsV2,
				})
				.catch(console.error);
		}
	});

	GitHub.on("organization", async event => {
		if (!webhook) return;
		const payload = event.payload;

		let title: string | undefined;
		let description: string | undefined;
		let timestamp: string | undefined = new Date().toISOString();
		let thumbnail: Discord.APIEmbedThumbnail | undefined;

		switch (payload.action) {
			case "member_invited":
				title = "member invited";
				description = `[${payload.invitation.inviter?.login}](${payload.invitation.inviter?.html_url}) invited [${payload.user?.login}](${payload.user?.html_url}) as \`${payload.invitation.role}\``;
				thumbnail = payload.user?.avatar_url
					? {
							url: payload.user.avatar_url,
						}
					: undefined;
				timestamp = payload.invitation.created_at;
				break;
			case "member_added":
				title = "member joined";
				description = `[${payload.membership.user?.login}](${payload.membership.user?.html_url}) joined ${payload.organization.login} as \`${payload.membership.role}\``;
				thumbnail = payload.membership.user?.avatar_url
					? {
							url: payload.membership.user.avatar_url,
						}
					: undefined;
				break;
			case "member_removed":
				title = "member removed";
				description = `[${payload.membership.user?.login}](${payload.membership.user?.html_url}) left ${payload.organization.login}`;
				thumbnail = payload.membership.user?.avatar_url
					? {
							url: payload.membership.user.avatar_url,
						}
					: undefined;
				break;
			case "renamed":
				title = "renamed organisation";
				description = `${payload.changes?.login?.from} -> ${payload.organization.login}`;
				break;
			case "deleted":
				title = `deleted organisation ${payload.organization.login}`;
				break;
			default:
				title = "unknown organisation action???";
				break;
		}

		const messagePayload = <Discord.WebhookMessageCreateOptions>{
			...CreateOptions,
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

		webhook.send(messagePayload).catch(console.error);
	});

	GitHub.on("membership", async event => {
		if (!webhook) return;
		const payload = event.payload;

		const messagePayload = <Discord.WebhookMessageCreateOptions>{
			...CreateOptions,
			username: payload.sender?.name ?? payload.sender?.login ?? "unknown",
			avatarURL: payload.sender?.avatar_url,
			embeds: [
				{
					author: {
						name: payload.organization.login,
						url: payload.organization.url,
						icon_url: payload.organization.avatar_url,
					},
					thumbnail: {
						url: payload.member?.avatar_url,
					},
					title: "Membership " + event.payload.action,
					description: `[${payload.sender?.login}](${payload.sender?.html_url}) ${event.payload.action} [${payload.member?.login}](${payload.member?.html_url}) to ${payload.team.name}`,
					timestamp: new Date().toISOString(),
				},
			],
		};

		webhook.send(messagePayload).catch(console.error);
	});

	GitHub.on("team", async event => {
		if (!webhook) return;
		const payload = event.payload;

		let title: string | undefined;
		let description: string | undefined;
		switch (event.payload.action) {
			case "added_to_repository":
				title = "team added to repository";
				description = `[${payload.sender?.login}](${payload.sender?.html_url}) added [${payload.team.name}](${payload.team.html_url}) to [${payload.repository?.name}](${payload.repository?.html_url})`;
				break;
			case "removed_from_repository":
				title = "team removed from repository";
				description = `[${payload.sender?.login}](${payload.sender?.html_url}) removed [${payload.team.name}](${payload.team.html_url}) from [${payload.repository?.name}](${payload.repository?.html_url})`;
				break;
			case "created":
				title = "team created";
				description = `[${payload.sender?.login}](${payload.sender?.html_url}) created [${payload.team.name}](${payload.team.html_url})`;
			case "deleted":
				title = "team deleted";
				description = `[${payload.sender?.login}](${payload.sender?.html_url}) deleted [${payload.team.name}](${payload.team.html_url})`;
			case "edited":
				title = "team edited";
				description = `[${payload.sender?.login}](${payload.sender?.html_url}) edited [${payload.team.name}](${payload.team.html_url})`;
			default:
				title = "unknown team action???";
				break;
		}

		const messagePayload: Discord.WebhookMessageCreateOptions = {
			...CreateOptions,
			username: payload.sender?.name ?? payload.sender?.login,
			avatarURL: payload.sender?.avatar_url,
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

		webhook.send(messagePayload).catch(console.error);
	});
};
