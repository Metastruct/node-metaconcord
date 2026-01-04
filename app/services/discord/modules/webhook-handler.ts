import * as Discord from "discord.js";
import { DiscordBot } from "../index.js";
import { Webhooks, createNodeMiddleware } from "@octokit/webhooks";
import { clamp, logger } from "@/utils.js";
import axios from "axios";
import webhookConfig from "@/config/webhooks.json" with { type: "json" };
import { EmitterWebhookEvent } from "@octokit/webhooks/types";
import { components } from "@octokit/openapi-types";
import apiKeys from "@/config/apikeys.json" with { type: "json" };
import type { CommitDiffSchema } from "@gitbeaker/rest";

const log = logger(import.meta);

const COLOR_MOD = 75;
const COLOR_BASE = 50;

function GetColorFromChanges(added: number, removed: number, modified: number) {
	return (
		clamp(COLOR_BASE + COLOR_MOD * removed, COLOR_BASE, 255) * 65536 +
		clamp(COLOR_BASE + COLOR_MOD * added, COLOR_BASE, 255) * 256 +
		clamp(COLOR_BASE + COLOR_MOD * modified, COLOR_BASE, 255)
	);
}

const DIFF_SIZE = 2048;
const MAX_FIELDS = 10;
const MAX_COMMITS = 5;

const MinimalPushUsers = ["MetaAutomator"];

const GitHub = new Webhooks({
	secret: webhookConfig.github.secret,
});

const BaseEmbed = <Discord.WebhookMessageCreateOptions>{
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
	const res = await fetch(url + ".diff");

	const text = await res.text();
	if (!res.ok) {
		log.error({ text }, "failed to fetch Github diff");
		return;
	}

	return text
		.replaceAll(/(@@ -\d+,\d+ .+\d+,\d+ @@)[^\n]/g, "$1\n")
		.replaceAll(/diff.+\nindex.+\n/g, "")
		.replaceAll("```", "​`​`​`");
};

const getGitlabDiff = async (id: string, sha: string) => {
	const res = await fetch(
		`https://gitlab.com/api/v4/projects/${encodeURIComponent(id)}/repository/commits/${sha}/diff`,
		{
			headers: {
				"PRIVATE-TOKEN": apiKeys.gitlab,
			},
		}
	);

	if (!res.ok) {
		const text = await res.text();
		log.error({ text }, "failed to fetch Gitlab diff");
		return;
	}

	return res.json() as Promise<CommitDiffSchema[]>;
};

const FIELD_REGEX = /^(?:Add|Mod|Del) \[(.+)\]/g;

const SERVER_EMOJI_MAP = {
	"1": "1️⃣",
	"2": "2️⃣",
	"3": "3️⃣",
	"4": "4️⃣",
};

const REPO_SERVER_MAP = new Map([
	["Lumiens-Map-Vote", [3, 4]],
	["MTA-Gamemode", [3, 4]],
	["terrortown_modding", [3, 4]],
	["ttt_player_tumbler", [3, 4]],
	["ttt_ragmod", [3, 4]],
	["TTT2", [3, 4]],
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
	const bridge = await bot.container.getService("GameBridge");

	const github = await bot.container.getService("Github");

	bot.discord.on("clientReady", async () => {
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
							.sshExecCommand("gserv qu rehash", {
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
						log.error(err);
					});
				break;
			case "everything":
				const msg = ctx.message;
				const url = msg.embeds[msg.embeds.length - 1].url;
				if (!url) {
					await ctx.reply("url not found for refreshing :( ... aborting");
					return;
				}

				let files: string[] | undefined;

				// what could go wrong
				if (url.startsWith("https://github.com")) {
					const [, owner, repo, ref] =
						/https?:\/\/github\.com\/(?<owner>\S+)\/(?<repo>\S+)\/commit\/(?<sha>\S+)/.exec(
							url ?? ""
						) || [];
					try {
						const res = await github.octokit.rest.repos.getCommit({ owner, repo, ref });
						files = res.data.files?.flatMap(f => f.filename);
					} catch (err) {
						await ctx.reply(
							"something went wrong fetching the files from github :( ... aborting\n" +
								`\`${err.message}\``
						);
						log.error(
							{ err, context: { url, owner, repo, ref } },
							"Failed to fetch files from GitHub"
						);
						return;
					}
				} else if (url.startsWith("https://gitlab.com")) {
					const [, id, sha] =
						/https?:\/\/gitlab\.com\/(?<id>\S+)\/-\/commit\/(?<sha>\S+)/.exec(
							url ?? ""
						) || [];
					try {
						const diffs = await getGitlabDiff(id, sha);
						files = diffs?.filter(f => !f.deleted_file).flatMap(f => f.new_path);
					} catch (err) {
						await ctx.reply(
							"something went wrong fetching the files from gitlab :( ... aborting\n" +
								`\`${err.message}\``
						);
						log.error(
							{
								err,
								context: {
									url,
									id,
									sha,
								},
							},
							"Failed to fetch files from Gitlab"
						);
						return;
					}
				}

				if (!files || files.length === 0) {
					await ctx.reply("no files found for refreshing :( ... aborting");
					return;
				}

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
							.sshExecCommand("gserv qu rehash", {
								stream: "stderr",
							})
							.then(async () => {
								const channel = <Discord.TextBasedChannel>(
									await server.discord.channels.fetch(reply.channelId)
								);
								(await channel.messages.fetch(reply)).react("📥");
							});

						const res = await server.sendLua(
							'if not RefreshLua then return false, "RefreshLua missing?" end\n' +
								files
									.filter(f => f && f.split(".")[1] === "lua")
									.map(f => `RefreshLua([[${f}]])`)
									.join("\n"),
							"sv",
							ctx.user.displayName
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
						log.error(err);
					});
				break;
		}
	});

	async function DefaultPushHandler(event: EmitterWebhookEvent<"push">) {
		const payload = event.payload;
		const repo = payload.repository;
		const serverOverride = REPO_SERVER_MAP.get(repo.name);
		const commits = payload.commits;
		const branch = payload.ref.split("/")[2];

		let includesLua = false;

		const embeds: Discord.APIEmbed[] = [];

		if (payload.head_commit && isRemoteMergeCommit(payload.head_commit.message))
			commits.splice(0, commits.length, payload.head_commit);

		if (commits.length > MAX_COMMITS) {
			const embed: Discord.APIEmbed = {
				title: `${commits.length} commits in this push`,
				description: `[View all changes](${payload.compare})`,
				author: {
					name:
						branch !== repo.default_branch
							? (repo.name + "/" + branch).substring(0, 256)
							: repo.name.substring(0, 256),
					url: repo.html_url,
					icon_url: repo.owner?.avatar_url,
				},
				color: 0xffd700,
				timestamp: new Date().toISOString(),
				footer: {
					text: `by ${payload.sender?.name ?? payload.sender?.login ?? "unknown"}`,
				},
			};

			embeds.push(embed);
		} else {
			for (const commit of commits) {
				const fields: Discord.APIEmbedField[] = [];
				const changes = GetGithubChanges(
					repo.full_name,
					payload.ref,
					commit.added,
					commit.removed,
					commit.modified
				);

				if (MinimalPushUsers.includes(commit.author.username ?? commit.author.name)) {
					embeds.push({
						title:
							commit.message.length > 256
								? `${commit.message.substring(0, 250)}. . .`
								: commit.message,
						description: `[${changes.length} file${changes.length > 1 ? "s" : ""} changed.](${payload.compare})`,
						author: {
							name:
								branch !== repo.default_branch
									? (repo.name + "/" + branch).substring(0, 256)
									: repo.name.substring(0, 256),
							url: repo.html_url,
							icon_url: repo.owner?.avatar_url,
						},
						color: GetColorFromChanges(
							commit.added?.length ?? 0,
							commit.removed?.length ?? 0,
							commit.modified?.length ?? 0
						),
						url: commit.url,
						fields,
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
					continue;
				}

				const allFiles = [
					...(commit.added ?? []),
					...(commit.modified ?? []),
					...(commit.removed ?? []),
				];

				includesLua = allFiles.length > 0 && allFiles.some(str => str.endsWith(".lua"));

				const isOnlyOgg =
					allFiles.length > 0 && allFiles.every(str => str.endsWith(".ogg"));

				const oversize = changes.length > MAX_FIELDS;
				const changeLen = oversize ? MAX_FIELDS : changes.length;

				for (let i = 0; i < changeLen; i++) {
					const change = changes[i];
					if (i === 24 || oversize ? i === changeLen - 1 : false) {
						fields.push({
							name: "︎",
							value: `... and ${changes.length - changeLen} more changes`,
						});
						break;
					} else {
						fields.push({
							name: i > 0 ? "︎" : "---",
							value: change.length > 1024 ? "<LINK TOO LONG>" : change,
						});
					}
				}

				const diff =
					isMergeCommit(commit.message) || isOnlyOgg
						? undefined
						: await getGitHubDiff(commit.url);

				embeds.push({
					title:
						commit.message.length > 256
							? `${commit.message.substring(0, 250)}. . .`
							: commit.message,
					description: diff
						? `\`\`\`diff\n${
								diff.length > DIFF_SIZE - 12
									? diff.substring(0, 4079) + ". . ."
									: diff
							}\`\`\``
						: undefined,
					author: {
						name:
							branch !== repo.default_branch
								? (repo.name + "/" + branch).substring(0, 256)
								: repo.name.substring(0, 256),
						url: repo.html_url,
						icon_url: repo.owner?.avatar_url,
					},
					color: GetColorFromChanges(
						commit.added?.length ?? 0,
						commit.removed?.length ?? 0,
						commit.modified?.length ?? 0
					),
					url: commit.url,
					fields,
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
		}
		const messagePayload = <Discord.WebhookMessageCreateOptions>{
			...BaseEmbed,
			username: payload.sender?.name ?? payload.sender?.login ?? "unknown",
			avatarURL: payload.sender?.avatar_url,
			content: payload.forced
				? "<a:ALERTA:843518761160015933> Force Pushed <a:ALERTA:843518761160015933>"
				: "",
			embeds,
		};
		const components = <Discord.APIActionRowComponent<Discord.APIComponentInMessageActionRow>>{
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
			for (let i = 0; i < embeds.length; i++) {
				const chunk = embeds.slice(i, i + 1);
				webhook.send({
					...messagePayload,
					embeds: chunk,
					components: i === embeds.length - 1 && includesLua ? [components] : undefined,
				});
			}
		} else {
			webhook
				.send({
					...messagePayload,
					components: includesLua ? [components] : undefined,
				})
				.catch(log.error.bind(log));
		}
	}

	function GroupSoundFilesByFolder(paths: string[]) {
		// behold my newest creation that no one will get on their first read
		// example path "sound/chatsounds/autoadd/{foldername}/{soundname}"
		return paths.reduce((map, path) => {
			const [mainFolder, , , folderName, soundName] = path.split("/");
			if (mainFolder !== "sound" || !folderName || !soundName) return map;
			map.set(folderName, [
				...(map.get(folderName) ?? []),
				soundName.replace(/\.[^/.]+$/, ""),
			]);
			return map;
		}, new Map<string, string[]>());
	}

	const formatSounds = ([folderName, sounds]: [string, string[]]) => {
		// idk why but I feel like there has to be a better way to do this
		// but this seems fine after for now after 3 beer
		const soundCount = new Map<string, number>();
		for (const sound of sounds) {
			soundCount.set(sound, (soundCount.get(sound) ?? 0) + 1);
		}
		const fileName = Array.from(soundCount, ([sound, count]) => {
			return `- \`${sound}\`${count > 1 ? ` x${count}` : ""}`;
		}).join("\n");
		return `[**${folderName}**](https://github.com/Metastruct/garrysmod-chatsounds/tree/master/sound/chatsounds/autoadd/${folderName})\n${fileName}`;
	};

	async function ChatsoundsPushHandler(event: EmitterWebhookEvent<"push">) {
		const chatWebhook = bridge.discordChatWH;
		const payload = event.payload;
		const commits = payload.commits;

		if (payload.sender?.type === "Bot") {
			return;
		}

		if (payload.head_commit && isRemoteMergeCommit(payload.head_commit.message))
			commits.splice(0, commits.length, payload.head_commit);

		const container = new Discord.ContainerBuilder();

		for (const commit of commits) {
			container.setAccentColor(
				GetColorFromChanges(
					commit.added?.length ?? 0,
					commit.removed?.length ?? 0,
					commit.modified?.length ?? 0
				)
			);

			container.addTextDisplayComponents(text =>
				text.setContent(`# [Chatsound Update](${commit.url})`)
			);

			container.addSeparatorComponents(sep => sep);

			const addedSounds = GroupSoundFilesByFolder(commit.added ?? []);
			const removedSounds = GroupSoundFilesByFolder(commit.removed ?? []);
			const modifiedSounds = GroupSoundFilesByFolder(commit.modified ?? []);

			// maybe there is a better way instead of if-chaining this but whatever
			if (commit.added && addedSounds.size > 0) {
				container.addTextDisplayComponents(text =>
					text.setContent(
						`### Added ${commit.added?.length} new sound${(commit.added?.length ?? 0 > 1) ? "s" : ""}:\n${Array.from(
							addedSounds
						)
							.map(formatSounds)
							.join("\n\n")}`
					)
				);

				container.addSeparatorComponents(sep => sep);
			}
			if (commit.removed && removedSounds.size > 0) {
				container.addTextDisplayComponents(text =>
					text.setContent(
						`### Removed ${commit.removed?.length} sound${(commit.removed?.length ?? 0 > 1) ? "s" : ""}:\n${Array.from(
							removedSounds
						)
							.map(formatSounds)
							.join("\n\n")}`
					)
				);

				container.addSeparatorComponents(sep => sep);
			}
			if (commit.modified && modifiedSounds.size > 0) {
				container.addTextDisplayComponents(text =>
					text.setContent(
						`### Changed ${commit.modified?.length} sound${(commit.modified?.length ?? 0 > 1) ? "s" : ""}:\n${Array.from(
							modifiedSounds
						)
							.map(formatSounds)
							.join("\n\n")}`
					)
				);

				container.addSeparatorComponents(sep => sep);
			}
			container.addTextDisplayComponents(text =>
				text.setContent(
					`-# added by ${commit.author.username ?? commit.author.name} via \`${commit.message.split("\n\n")[0]}\`, approved by ${payload.pusher.username ?? payload.pusher.name}`
				)
			);
		}
		const message = {
			username: payload.sender?.name ?? payload.sender?.login ?? "unknown",
			avatarURL: payload.sender?.avatar_url,
			components: [container],
			flags: Discord.MessageFlags.IsComponentsV2,
		} as Discord.MessageCreateOptions;

		webhook.send(message);
		chatWebhook.send({ ...message, withComponents: true });
	}

	GitHub.on("push", async event => {
		if (!webhook) return;
		switch (event.payload.repository.name) {
			case "garrysmod-chatsounds":
				ChatsoundsPushHandler(event);
				break;

			default:
				DefaultPushHandler(event);
				break;
		}
	});

	async function ChatsoundsPullrequestOpenedHandler(
		event: EmitterWebhookEvent<"pull_request.opened">
	) {
		const payload = event.payload;

		const diff = await axios.get<components["schemas"]["diff-entry"][]>(
			event.payload.pull_request.url + "/files"
		); // why this isn't in the payload I have no idea

		const changedFiles = GroupSoundFilesByFolder(diff.data.map(d => d.filename));

		const container = new Discord.ContainerBuilder();

		container.setAccentColor(payload.pull_request.state === "open" ? 5763719 : 15277667);

		container.addTextDisplayComponents(text =>
			text.setContent(
				`# [Chatsound Request \`#${payload.number} ${payload.pull_request.title}\`](${payload.pull_request.html_url})`
			)
		);

		container.addSeparatorComponents(sep => sep);

		container.addTextDisplayComponents(text =>
			text.setContent(
				`### [${payload.sender.login}](${payload.sender.html_url}) wants to add/change ${payload.pull_request.changed_files} sound${changedFiles.size > 1 ? "s" : ""}:\n${Array.from(
					changedFiles
				)
					.map(formatSounds)
					.join("\n\n")}`
			)
		);

		webhook.send({
			username: payload.sender.name ?? payload.sender.login ?? "unknown",
			avatarURL: payload.sender.avatar_url,
			components: [container],
			flags: Discord.MessageFlags.IsComponentsV2,
		});
	}

	GitHub.on("pull_request", async event => {
		if (!webhook) return;
		switch (event.payload.repository.name) {
			case "garrysmod-chatsounds":
				if (event.payload.action === "opened")
					ChatsoundsPullrequestOpenedHandler(
						event as EmitterWebhookEvent<"pull_request.opened">
					);
				break;

			default:
				// todo lol
				break;
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
					thumbnail,
					title,
					description,
					timestamp,
				},
			],
		};

		webhook.send(messagePayload).catch(log.error.bind(log));
	});

	GitHub.on("membership", async event => {
		if (!webhook) return;
		const payload = event.payload;

		const messagePayload = <Discord.WebhookMessageCreateOptions>{
			...BaseEmbed,
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

		webhook.send(messagePayload).catch(log.error.bind(log));
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
			...BaseEmbed,
			username: payload.sender?.name ?? payload.sender?.login,
			avatarURL: payload.sender?.avatar_url,
			embeds: [
				{
					author: {
						name: payload.organization.login,
						url: payload.organization.url,
						icon_url: payload.organization.avatar_url,
					},
					title,
					description,
					timestamp: new Date().toISOString(),
				},
			],
		};

		webhook.send(messagePayload).catch(log.error.bind(log));
	});
};
