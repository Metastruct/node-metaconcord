import * as Discord from "discord.js";
import { DiscordBot } from "../index.js";
import express from "express";
import { Webhooks, createNodeMiddleware } from "@octokit/webhooks";
import { clamp, logger } from "@/utils.js";
import { chatWebhook } from "@/app/services/gamebridge/games/gmod/webhooks.js";
import axios from "axios";
import webhookConfig from "@/config/webhooks.json" with { type: "json" };
import { EmitterWebhookEvent } from "@octokit/webhooks/types";
import { components } from "@octokit/openapi-types";
import type {
	CommitDiffSchema,
	Gitlab as GitlabClient,
	WebhookMergeRequestEventSchema,
	WebhookPipelineEventSchema,
	WebhookPushEventSchema,
} from "@gitbeaker/rest";
import type { Octokit } from "@octokit/rest";
import gitlabConfig from "@/config/gitlab.json" with { type: "json" };

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

// Components V2 caps the combined length of all Text Display content at 4000
// characters per message (not per-component like embed fields were), so these
// are sized to leave headroom for the header/footer text sharing the container.
const DIFF_SIZE = 1500;
const BODY_SIZE = 300;
const PR_BODY_SIZE = 1500;
const CHANGE_LIST_SIZE = 1000;
const MAX_FIELDS = 10;
const MAX_COMMITS = 5;
const COMPONENT_TEXT_LIMIT = 4000;

const MinimalPushUsers = ["MetaAutomator", "github-actions[bot]"];

const CHECK_CONCLUSION_COLOR: Record<string, number> = {
	success: 0x28a745,
	failure: 0xcb2431,
	failed: 0xcb2431, // Gitlab pipeline status spelling, as opposed to Github's "failure"
	timed_out: 0xcb2431,
	startup_failure: 0xcb2431,
	action_required: 0xdbab09,
	cancelled: 0x6a737d,
	canceled: 0x6a737d, // Gitlab spelling
	skipped: 0x6a737d,
	neutral: 0x6a737d,
	stale: 0x6a737d,
};

const CHECK_CONCLUSION_EMOJI: Record<string, string> = {
	success: "✅",
	failure: "❌",
	failed: "❌", // Gitlab pipeline status spelling, as opposed to Github's "failure"
	timed_out: "⏱️",
	startup_failure: "❌",
	action_required: "⚠️",
	cancelled: "🚫",
	canceled: "🚫", // Gitlab spelling
	skipped: "⏭️",
	neutral: "⚪",
	stale: "🟤",
};

function getCheckTarget(pullRequests: { number: number }[], headBranch?: string | null): string {
	return pullRequests.length > 0
		? `pull request #${pullRequests[0].number}`
		: (headBranch ?? "unknown branch");
}

type MessageComponent =
	| Discord.ContainerBuilder
	| Discord.TextDisplayBuilder
	| Discord.APIActionRowComponent<Discord.APIComponentInMessageActionRow>;

// Tracks the commit-push message for a given commit sha for a short while so a
// later check_run/check_suite completion can be appended to it in place via edit,
// instead of flooding the channel with a separate message per check result.
interface TrackedCommitMessage {
	messageId: string;
	components: MessageComponent[];
	container: Discord.ContainerBuilder;
	checksDisplay?: Discord.TextDisplayBuilder;
	checks: Map<string, string>;
}

const MAX_TRACKED_COMMITS = 200;
const commitMessages = new Map<string, TrackedCommitMessage>();

function trackCommitMessage(
	sha: string,
	messageId: string,
	components: MessageComponent[],
	container: Discord.ContainerBuilder
) {
	if (commitMessages.size >= MAX_TRACKED_COMMITS) {
		const oldest = commitMessages.keys().next().value;
		if (oldest) commitMessages.delete(oldest);
	}
	commitMessages.set(sha, { messageId, components, container, checks: new Map() });
}

function upsertCheckLine(entry: TrackedCommitMessage, key: string, line: string) {
	entry.checks.set(key, line);
	const content = Array.from(entry.checks.values()).join("\n");
	if (entry.checksDisplay) {
		entry.checksDisplay.setContent(content);
	} else {
		entry.container.addSeparatorComponents(sep => sep);
		entry.checksDisplay = new Discord.TextDisplayBuilder().setContent(content);
		entry.container.addTextDisplayComponents(entry.checksDisplay);
	}
}

const GitHub = new Webhooks({
	secret: webhookConfig.github.secret,
});

// @octokit/webhooks logs unhandled listener errors via its own default
// console-based logger, separate from our pino logger, which makes push/PR
// events that throw silently invisible in our normal logs. Route them here too.
GitHub.onError(error => {
	log.error(
		{ err: error, name: error.event?.name, errors: error.errors },
		"Github webhook event handler failed"
	);
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
			s => `+ [${s}](https://github.com/${repoPath}/blob/${sha}/${s.replaceAll(" ", "%%20")})`
		),
		...removed.map(
			// leading "-" is escaped: unescaped, Discord renders a line starting with
			// "- " as a markdown list bullet instead of a literal minus sign
			s =>
				`\\- [${s}](https://github.com/${repoPath}/blob/${sha}/${s.replaceAll(" ", "%%20")})`
		),
		...modified.map(
			s => `~ [${s}](https://github.com/${repoPath}/blob/${sha}/${s.replaceAll(" ", "%%20")})`
		),
	];
};

function formatDiffText(text: string): string {
	return text
		.replaceAll(/(@@ -\d+,\d+ .+\d+,\d+ @@)[^\n]/g, "$1\n")
		.replaceAll(/diff.+\nindex.+\n/g, "")
		.replaceAll("```", "​`​`​`");
}

// Uses the authenticated Octokit client (GitHub App install token) instead of an
// anonymous fetch to the ".diff" URL - anonymous github.com traffic is throttled much
// more aggressively and was intermittently getting its connection reset mid-request.
// The diff/patch media type still returns the same raw unified-diff text across all
// changed files, so the output (and the regex post-processing below) is unchanged.
const getGitHubCommitDiff = async (
	octokit: Octokit,
	owner: string,
	repo: string,
	ref: string
): Promise<string | undefined> => {
	try {
		const res = await octokit.rest.repos.getCommit({
			owner,
			repo,
			ref,
			mediaType: { format: "diff" },
			request: { signal: AbortSignal.timeout(10_000) },
		});
		return formatDiffText(res.data as unknown as string);
	} catch (err) {
		log.error({ err, owner, repo, ref }, "failed to fetch Github commit diff");
		return;
	}
};

const getGitHubPullRequestDiff = async (
	octokit: Octokit,
	owner: string,
	repo: string,
	pull_number: number
): Promise<string | undefined> => {
	try {
		const res = await octokit.rest.pulls.get({
			owner,
			repo,
			pull_number,
			mediaType: { format: "diff" },
			request: { signal: AbortSignal.timeout(10_000) },
		});
		return formatDiffText(res.data as unknown as string);
	} catch (err) {
		log.error({ err, owner, repo, pull_number }, "failed to fetch Github PR diff");
		return;
	}
};

const getPullRequestFiles = async (
	prApiUrl: string
): Promise<components["schemas"]["diff-entry"][] | undefined> => {
	try {
		const res = await axios.get<components["schemas"]["diff-entry"][]>(prApiUrl + "/files", {
			timeout: 10_000,
		}); // why this isn't in the payload I have no idea
		return res.data;
	} catch (err) {
		log.error({ err, prApiUrl }, "failed to fetch PR files from Github");
		return;
	}
};

const getGitlabDiff = async (
	api: GitlabClient,
	id: string | number,
	sha: string
): Promise<CommitDiffSchema[] | undefined> => {
	try {
		return await api.Commits.showDiff(id, sha);
	} catch (err) {
		log.error({ err, id, sha }, "failed to fetch Gitlab diff");
		return;
	}
};

const GetGitlabChanges = (
	pathWithNamespace: string,
	sha: string,
	added: string[] = [],
	removed: string[] = [],
	modified: string[] = []
): string[] => {
	const blobUrl = (path: string) =>
		`https://gitlab.com/${pathWithNamespace}/-/blob/${sha}/${path.replaceAll(" ", "%20")}`;
	return [
		...added.map(s => `+ [${s}](${blobUrl(s)})`),
		// leading "-" is escaped: unescaped, Discord renders a line starting with
		// "- " as a markdown list bullet instead of a literal minus sign
		...removed.map(s => `\\- [${s}](${blobUrl(s)})`),
		...modified.map(s => `~ [${s}](${blobUrl(s)})`),
	];
};

// Same idea as GetGitlabChanges, but for callers that only have the structured
// Commits.showDiff() response (e.g. merge requests, which don't carry per-commit
// added/removed/modified file lists in the webhook payload the way pushes do).
function GetGitlabDiffChanges(
	pathWithNamespace: string,
	sha: string,
	files: CommitDiffSchema[]
): string[] {
	return files.map(f => {
		// leading "-" is escaped: unescaped, Discord renders a line starting with
		// "- " as a markdown list bullet instead of a literal minus sign
		const prefix = f.new_file ? "+" : f.deleted_file ? "\\-" : "~";
		const path = f.deleted_file ? f.old_path : f.new_path;
		return `${prefix} [${path}](https://gitlab.com/${pathWithNamespace}/-/blob/${sha}/${path.replaceAll(" ", "%20")})`;
	});
}

// Gitlab's diff API returns one entry per changed file rather than a single unified-diff
// blob like Github's ".diff" format, so the per-file hunks are joined with the same
// "--- old\n+++ new" headers Github's raw diff includes, then run through the same
// formatDiffText() used for Github so both providers render identically in the codeblock.
function joinGitlabDiffFiles(files: CommitDiffSchema[]): string {
	return files
		.map(
			f =>
				(f.old_path === f.new_path
					? `+++ ${f.new_path}\n`
					: `--- ${f.old_path}\n+++ ${f.new_path}\n`) + f.diff
		)
		.join("\n");
}

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

const COMMIT_URL_REGEX =
	/https?:\/\/(?:github\.com\/[^\s)]+\/commit\/[^\s)]+|gitlab\.com\/[^\s)]+\/-\/commit\/[^\s)]+)/;

function collectComponentText(
	component: Discord.TopLevelComponent | Discord.ComponentInContainer
): string[] {
	if (component instanceof Discord.TextDisplayComponent) return [component.content];
	if (component instanceof Discord.ContainerComponent)
		return component.components.flatMap(collectComponentText);
	if (component instanceof Discord.SectionComponent)
		return component.components.map(c => c.content);
	return [];
}

// buttons on Components V2 push messages no longer have an embed to pull the commit url from
function findCommitUrl(message: Discord.Message): string | undefined {
	const text = message.components.flatMap(collectComponentText).join("\n");
	return COMMIT_URL_REGEX.exec(text)?.[0];
}

function buildChangeLines(changes: string[]): string[] {
	const lines: string[] = [];
	let length = 0;

	for (let i = 0; i < changes.length; i++) {
		if (i >= MAX_FIELDS || length + changes[i].length > CHANGE_LIST_SIZE) {
			lines.push(`... and ${changes.length - i} more changes`);
			break;
		}
		const change = changes[i].length > 1024 ? "<LINK TOO LONG>" : changes[i];
		lines.push(change);
		length += change.length;
	}
	return lines;
}

function GetPullRequestChanges(files: components["schemas"]["diff-entry"][]): string[] {
	return files.map(f => {
		// leading "-" is escaped: unescaped, Discord renders a line starting with
		// "- " as a markdown list bullet instead of a literal minus sign
		const prefix = f.status === "added" ? "+" : f.status === "removed" ? "\\-" : "~";
		return `${prefix} [${f.filename}](${f.blob_url})`;
	});
}

function formatCommitBody(message: string): string {
	const body = message.split("\n").slice(1).join("\n").trim();
	if (!body) return "";

	const truncated = body.length > BODY_SIZE ? `${body.substring(0, BODY_SIZE - 3)}...` : body;
	return "\n" + truncated.replaceAll(/^/gm, "> ");
}

// Unlike formatCommitBody (quoted inline after a commit title), a PR/MR body gets
// its own text display section, so no leading blockquote formatting is applied here.
function formatPrBody(body?: string | null): string {
	const trimmed = body?.trim();
	if (!trimmed) return "";
	return trimmed.length > PR_BODY_SIZE ? `${trimmed.substring(0, PR_BODY_SIZE - 3)}...` : trimmed;
}

function addContainerHeader(
	container: Discord.ContainerBuilder,
	repoLine: string,
	heading: string,
	iconUrl?: string
): Discord.ContainerBuilder {
	const content = `${repoLine}\n${heading}`;
	if (iconUrl) {
		container.addSectionComponents(section =>
			section
				.addTextDisplayComponents(text => text.setContent(content))
				.setThumbnailAccessory(thumb => thumb.setURL(iconUrl))
		);
	} else {
		container.addTextDisplayComponents(text => text.setContent(content));
	}
	return container;
}

export default async (bot: DiscordBot): Promise<void> => {
	const webapp = bot.container.getService("WebApp");

	const middleware = createNodeMiddleware(GitHub, { path: "/" });

	webapp.app.use("/webhooks/github", async (req, res, next) => {
		if (await middleware(req, res, next)) return;
		res.status(404).end();
	});

	// Gitlab has no signed-payload library like @octokit/webhooks - it just sends a
	// static secret in X-Gitlab-Token, compared directly against config. Acknowledge
	// immediately (Gitlab disables webhooks after repeated slow/failing deliveries)
	// and process in the background, matching how failures are surfaced elsewhere here.
	webapp.app.use("/webhooks/gitlab", express.json(), (req, res) => {
		if (req.headers["x-gitlab-token"] !== webhookConfig.gitlab.secret) {
			res.status(401).end();
			return;
		}
		res.status(200).end();

		const eventKind = req.body?.object_kind as string | undefined;
		const gitlabHandler = eventKind ? gitlabHandlers[eventKind] : undefined;
		if (!gitlabHandler) return;

		gitlabHandler(req.body).catch(err =>
			log.error({ err, eventKind }, "Gitlab webhook event handler failed")
		);
	});

	let webhook: Discord.Webhook;
	const bridge = bot.container.getService("GameBridge");

	const github = bot.container.getService("Github");
	const gitlab = bot.container.getService("Gitlab");

	// Channel ids Gitlab commits/merge requests/pipelines can be routed to
	// (config/gitlab.json maps project ids onto these), fetched/created lazily
	// and cached so each channel only gets one bot-owned webhook. The in-flight
	// promise itself is cached (not just the resolved value) so two events for the
	// same not-yet-cached channel arriving concurrently share one fetch/create call
	// instead of racing to each create their own webhook on that channel.
	const webhooksByChannel = new Map<string, Promise<Discord.Webhook | undefined>>();

	function getOrCreateWebhook(channelId: string): Promise<Discord.Webhook | undefined> {
		const cached = webhooksByChannel.get(channelId);
		if (cached) return cached;

		const promise = (async () => {
			const channel = bot.getTextChannel(channelId);
			if (!channel) return undefined;

			const hooks = await channel.fetchWebhooks();
			const botHook = hooks.filter(h => h.owner === bot.discord.user).first();
			return (
				botHook ??
				(await channel.createWebhook({
					name: "Commits",
					reason: "Webhook missing?",
				}))
			);
		})();

		promise.catch(() => webhooksByChannel.delete(channelId));
		webhooksByChannel.set(channelId, promise);
		return promise;
	}

	function getGitlabWebhook(projectId: number): Promise<Discord.Webhook | undefined> {
		const channelId =
			gitlabConfig.projectChannels[
				String(projectId) as keyof typeof gitlabConfig.projectChannels
			] || bot.config.channels.privateCommits;
		return getOrCreateWebhook(channelId);
	}

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
			webhooksByChannel.set(bot.config.channels.publicCommits, Promise.resolve(webhook));
		}
	});

	const allowedRoles = new Set([
		bot.config.roles.developer,
		bot.config.roles.newDeveloper,
		bot.config.roles.administrator,
	]);

	bot.discord.on("interactionCreate", async (ctx: Discord.ButtonInteraction) => {
		if (!ctx.member || !ctx.isButton() || !bridge) return;
		const [action, override] = ctx.customId.split("_");
		const where =
			override !== undefined
				? bridge.servers.gmod.filter(s =>
						override.split(",").includes(s.config.id.toString())
					)
				: bridge.servers.gmod.filter(s => !!s.config.ssh);

		const allowed = (<Discord.GuildMemberRoleManager>ctx.member.roles).cache.some(x =>
			allowedRoles.has(x.id)
		);

		if (!allowed) return;

		if (where.length === 0) {
			await ctx.reply(`<@${ctx.user.id}> no servers to update :(`);
			return;
		}

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
								where.length === bridge.servers.gmod.length - 1 // 0 = empty
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
			case "everything": {
				const msg = ctx.message;
				const url =
					msg.embeds.length > 0
						? msg.embeds[msg.embeds.length - 1].url
						: findCommitUrl(msg);
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
						const diffs = await getGitlabDiff(gitlab.api, id, sha);
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
									.filter(f => f && f.endsWith(".lua"))
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
								where.length === bridge.servers.gmod.length - 1 // 0 = empty
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
		}
	});

	async function DefaultPushHandler(event: EmitterWebhookEvent<"push">) {
		const payload = event.payload;
		const repo = payload.repository;
		const serverOverride = REPO_SERVER_MAP.get(repo.name);
		const commits = payload.commits;
		const branch = payload.ref.split("/")[2];

		let includesLua = false;

		const containers: Discord.ContainerBuilder[] = [];
		// parallel to `containers`; the commit sha each container's message should be
		// tracked under so a later check_run/check_suite completion can edit it in place
		const commitShas: (string | undefined)[] = [];

		const onDefaultBranch = branch === repo.default_branch;
		const repoLabel = onDefaultBranch
			? repo.name.substring(0, 256)
			: (repo.name + "/" + branch).substring(0, 256);
		const repoUrl = onDefaultBranch
			? repo.html_url
			: `${repo.html_url}/tree/${branch.split("/").map(encodeURIComponent).join("/")}`;

		if (payload.head_commit && isRemoteMergeCommit(payload.head_commit.message))
			commits.splice(0, commits.length, payload.head_commit);

		if (commits.length > MAX_COMMITS) {
			const container = new Discord.ContainerBuilder().setAccentColor(0xffd700);

			addContainerHeader(
				container,
				`[${repoLabel}](${repoUrl})`,
				`### ${commits.length} commits in this push\n[View all changes](${payload.compare})`,
				repo.owner?.avatar_url
			);
			container.addTextDisplayComponents(text =>
				text.setContent(
					`-# by ${payload.sender?.name ?? payload.sender?.login ?? "unknown"}`
				)
			);

			containers.push(container);
			commitShas.push(payload.head_commit?.id ?? commits[commits.length - 1]?.id);
		} else {
			for (const commit of commits) {
				const changes = GetGithubChanges(
					repo.full_name,
					payload.ref,
					commit.added,
					commit.removed,
					commit.modified
				);

				const subject = commit.message.split("\n")[0];
				const title = subject.length > 256 ? `${subject.substring(0, 250)}. . .` : subject;
				const body = formatCommitBody(commit.message);

				const footer = `-# ${commit.id.substring(0, 6)} by ${
					commit.author.username ?? commit.author.name
				}${
					commit.author.name !== commit.committer.name
						? ` via ${commit.committer.username ?? commit.committer.name}`
						: ""
				}`;

				const container = new Discord.ContainerBuilder().setAccentColor(
					GetColorFromChanges(
						commit.added?.length ?? 0,
						commit.removed?.length ?? 0,
						commit.modified?.length ?? 0
					)
				);

				if (MinimalPushUsers.includes(payload.sender?.login || payload.pusher.name)) {
					addContainerHeader(
						container,
						`[${repoLabel}](${repoUrl})`,
						`### [${title}](${commit.url})${body}\n[${changes.length} file${changes.length > 1 ? "s" : ""} changed.](${payload.compare})`,
						repo.owner?.avatar_url
					);
					container.addTextDisplayComponents(text => text.setContent(footer));

					containers.push(container);
					commitShas.push(commit.id);
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

				const changeLines = buildChangeLines(changes);

				const diff =
					isMergeCommit(commit.message) || isOnlyOgg || !repo.owner
						? undefined
						: await getGitHubCommitDiff(
								github.octokit,
								repo.owner.login,
								repo.name,
								commit.id
							);

				addContainerHeader(
					container,
					`[${repoLabel}](${repoUrl})`,
					`### [${title}](${commit.url})${body}`,
					repo.owner?.avatar_url
				);

				if (diff) {
					container.addSeparatorComponents(sep => sep);
					container.addTextDisplayComponents(text =>
						text.setContent(
							`\`\`\`diff\n${
								diff.length > DIFF_SIZE
									? diff.substring(0, DIFF_SIZE - 5) + ". . ."
									: diff
							}\`\`\``
						)
					);
				}

				if (changeLines.length > 0) {
					container.addSeparatorComponents(sep => sep);
					container.addTextDisplayComponents(text =>
						text.setContent(changeLines.join("\n"))
					);
				}

				container.addSeparatorComponents(sep => sep.setDivider(false));
				container.addTextDisplayComponents(text => text.setContent(footer));

				containers.push(container);
				commitShas.push(commit.id);
			}
		}

		const baseMessagePayload = <Discord.WebhookMessageCreateOptions>{
			...BaseEmbed,
			username: payload.sender?.name ?? payload.sender?.login ?? "unknown",
			avatarURL: payload.sender?.avatar_url,
			flags: Discord.MessageFlags.IsComponentsV2,
		};

		const forcePushText = payload.forced
			? new Discord.TextDisplayBuilder().setContent(
					"<a:ALERTA:843518761160015933> Force Pushed <a:ALERTA:843518761160015933>"
				)
			: undefined;

		const actionRow = <Discord.APIActionRowComponent<Discord.APIComponentInMessageActionRow>>{
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

		if (containers.length > 1) {
			for (let i = 0; i < containers.length; i++) {
				const messageComponents: MessageComponent[] = [];
				if (i === 0 && forcePushText) messageComponents.push(forcePushText);
				messageComponents.push(containers[i]);
				if (i === containers.length - 1 && includesLua) messageComponents.push(actionRow);

				const sha = commitShas[i];
				webhook
					.send({
						...baseMessagePayload,
						components: messageComponents,
					})
					.then(msg => {
						if (sha) trackCommitMessage(sha, msg.id, messageComponents, containers[i]);
					})
					.catch(log.error.bind(log));
			}
		} else {
			const messageComponents: MessageComponent[] = [];
			if (forcePushText) messageComponents.push(forcePushText);
			messageComponents.push(...containers);
			if (includesLua) messageComponents.push(actionRow);

			const sha = commitShas[0];
			webhook
				.send({
					...baseMessagePayload,
					components: messageComponents,
				})
				.then(msg => {
					if (sha && containers[0])
						trackCommitMessage(sha, msg.id, messageComponents, containers[0]);
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
		return `[**${folderName}**](https://github.com/Metastruct/garrysmod-chatsounds/tree/master/sound/chatsounds/autoadd/${encodeURI(folderName)})\n${fileName}`;
	};

	async function ChatsoundsPushHandler(event: EmitterWebhookEvent<"push">) {
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
						`### Added ${commit.added?.length} new sound${(commit.added?.length ?? 0) > 1 ? "s" : ""}:\n${Array.from(
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
						`### Removed ${commit.removed?.length} sound${(commit.removed?.length ?? 0) > 1 ? "s" : ""}:\n${Array.from(
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
						`### Changed ${commit.modified?.length} sound${(commit.modified?.length ?? 0) > 1 ? "s" : ""}:\n${Array.from(
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
		const messageComponents: MessageComponent[] = [container];
		const message = {
			username: payload.sender?.name ?? payload.sender?.login ?? "unknown",
			avatarURL: payload.sender?.avatar_url,
			components: messageComponents,
			flags: Discord.MessageFlags.IsComponentsV2,
		} as Discord.MessageCreateOptions;

		const sha = payload.head_commit?.id ?? commits[commits.length - 1]?.id;
		webhook
			.send(message)
			.then(msg => {
				if (sha) trackCommitMessage(sha, msg.id, messageComponents, container);
			})
			.catch(log.error.bind(log));
		chatWebhook.send({ ...message, withComponents: true }).catch(log.error.bind(log));
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

		const files = await getPullRequestFiles(event.payload.pull_request.url);
		if (!files) return;

		const changedFiles = GroupSoundFilesByFolder(files.map(d => d.filename));

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
				`### [${payload.sender.login}](${payload.sender.html_url}) wants to add/change ${payload.pull_request.changed_files} sound${payload.pull_request.changed_files > 1 ? "s" : ""}:\n${Array.from(
					changedFiles
				)
					.map(formatSounds)
					.join("\n\n")}`
			)
		);

		const msg = await webhook
			.send({
				username: payload.sender.name ?? payload.sender.login ?? "unknown",
				avatarURL: payload.sender.avatar_url,
				components: [container],
				flags: Discord.MessageFlags.IsComponentsV2,
			})
			.catch(log.error.bind(log));

		if (msg) trackCommitMessage(payload.pull_request.head.sha, msg.id, [container], container);
	}

	async function DefaultPullRequestHandler(event: EmitterWebhookEvent<"pull_request">) {
		const payload = event.payload;
		const pr = payload.pull_request;
		const repo = payload.repository;

		let action: string;
		switch (payload.action) {
			case "opened":
				action = "opened";
				break;
			case "reopened":
				action = "reopened";
				break;
			case "ready_for_review":
				action = "marked ready for review";
				break;
			case "closed":
				action = pr.merged ? "merged" : "closed";
				break;
			default:
				return;
		}

		const title = pr.title.length > 256 ? `${pr.title.substring(0, 250)}. . .` : pr.title;

		const diff = await getGitHubPullRequestDiff(
			github.octokit,
			repo.owner.login,
			repo.name,
			pr.number
		);

		const files = await getPullRequestFiles(pr.url);
		const changeLines = files ? buildChangeLines(GetPullRequestChanges(files)) : [];
		const prBody = formatPrBody(pr.body);

		const container = new Discord.ContainerBuilder().setAccentColor(
			payload.action === "closed"
				? pr.merged
					? 0x8957e5
					: 0xe74c3c
				: GetColorFromChanges(pr.additions ?? 0, pr.deletions ?? 0, pr.changed_files ?? 0)
		);

		const repoLine = `-# [${repo.full_name.substring(0, 256)}](${repo.html_url})`;
		const heading = `### [${title}](${pr.html_url})`;
		const diffContent = diff
			? `\`\`\`diff\n${
					diff.length > DIFF_SIZE ? diff.substring(0, DIFF_SIZE - 5) + ". . ." : diff
				}\`\`\``
			: "";
		const changeLinesContent = changeLines.join("\n");
		const footerContent = `-# PR #${pr.number} ${action} by ${pr.user?.login ?? "unknown"}`;

		// The PR body is prioritised over the diff codeblock: if showing both would blow
		// past the Components V2 per-message text cap, drop the diff and keep the body.
		const showDiff =
			!!diffContent &&
			repoLine.length +
				heading.length +
				prBody.length +
				diffContent.length +
				changeLinesContent.length +
				footerContent.length <=
				COMPONENT_TEXT_LIMIT;

		addContainerHeader(container, repoLine, heading, repo.owner?.avatar_url);

		if (prBody) {
			container.addSeparatorComponents(sep => sep);
			container.addTextDisplayComponents(text => text.setContent(prBody));
		}

		if (showDiff) {
			container.addSeparatorComponents(sep => sep);
			container.addTextDisplayComponents(text => text.setContent(diffContent));
		}

		if (changeLines.length > 0) {
			container.addSeparatorComponents(sep => sep);
			container.addTextDisplayComponents(text => text.setContent(changeLinesContent));
		}

		container.addSeparatorComponents(sep => sep.setDivider(false));
		container.addTextDisplayComponents(text => text.setContent(footerContent));

		const msg = await webhook
			.send({
				...BaseEmbed,
				username: payload.sender?.name ?? payload.sender?.login ?? "unknown",
				avatarURL: payload.sender?.avatar_url,
				components: [container],
				flags: Discord.MessageFlags.IsComponentsV2,
			})
			.catch(log.error.bind(log));

		if (msg) trackCommitMessage(pr.head.sha, msg.id, [container], container);
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
				DefaultPullRequestHandler(event);
				break;
		}
	});

	GitHub.on("workflow_run.completed", async event => {
		if (!webhook) return;
		const payload = event.payload;
		const run = payload.workflow_run;
		const conclusion = run.conclusion;
		if (!conclusion) return;

		const repo = payload.repository;
		const name = run.name ?? "Workflow";

		const tracked = commitMessages.get(run.head_sha);
		if (tracked) {
			upsertCheckLine(
				tracked,
				`run:${run.id}`,
				`${CHECK_CONCLUSION_EMOJI[conclusion] ?? "⚪"} [${name}](${run.html_url}) ${conclusion}`
			);
			await webhook
				.editMessage(tracked.messageId, {
					components: tracked.components,
					flags: Discord.MessageFlags.IsComponentsV2,
				})
				.catch(log.error.bind(log));
			return;
		}

		const target = getCheckTarget(
			run.pull_requests.filter(pr => pr !== null),
			run.head_branch
		);

		await webhook
			.send({
				...BaseEmbed,
				username: repo.full_name,
				avatarURL: repo.owner?.avatar_url,
				embeds: [
					{
						color: CHECK_CONCLUSION_COLOR[conclusion] ?? 0x6a737d,
						title: `${name} ${conclusion} on ${target}`,
						url: run.html_url,
					},
				],
			})
			.catch(log.error.bind(log));
	});

	GitHub.on("organization", async event => {
		if (!webhook) return;
		const payload = event.payload;

		let title: string | undefined;
		let description: string | undefined;
		let timestamp: string | undefined = new Date().toISOString();
		let thumbnail: Discord.APIEmbedImage | undefined;

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
					description: `[${payload.sender?.login}](${payload.sender?.html_url}) ${event.payload.action} [${payload.member?.login}](${payload.member?.html_url}) ${event.payload.action === "removed" ? "from" : "to"} ${payload.team.name}`,
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
				break;
			case "deleted":
				title = "team deleted";
				description = `[${payload.sender?.login}](${payload.sender?.html_url}) deleted [${payload.team.name}](${payload.team.html_url})`;
				break;
			case "edited":
				title = "team edited";
				description = `[${payload.sender?.login}](${payload.sender?.html_url}) edited [${payload.team.name}](${payload.team.html_url})`;
				break;
			default:
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

	async function GitlabPushHandler(body: WebhookPushEventSchema): Promise<void> {
		const project = body.project;
		const commits = body.commits ?? [];
		if (commits.length === 0) return;

		const destWebhook = await getGitlabWebhook(project.id);
		if (!destWebhook) return;

		const branch = body.ref.split("/").slice(2).join("/");
		const onDefaultBranch = branch === project.default_branch;
		const repoLabel = onDefaultBranch
			? project.path_with_namespace.substring(0, 256)
			: (project.path_with_namespace + "/" + branch).substring(0, 256);
		const repoUrl = onDefaultBranch
			? project.web_url
			: `${project.web_url}/-/tree/${branch.split("/").map(encodeURIComponent).join("/")}`;

		let includesLua = false;
		const containers: Discord.ContainerBuilder[] = [];
		const commitShas: (string | undefined)[] = [];

		if (commits.length > MAX_COMMITS) {
			const container = new Discord.ContainerBuilder().setAccentColor(0xffd700);

			addContainerHeader(
				container,
				`[${repoLabel}](${repoUrl})`,
				`### ${commits.length} commits in this push\n[View all changes](${project.web_url}/-/compare/${body.before}...${body.after})`,
				project.avatar_url ?? undefined
			);
			container.addTextDisplayComponents(text => text.setContent(`-# by ${body.user_name}`));

			containers.push(container);
			commitShas.push(body.checkout_sha || commits[commits.length - 1]?.id);
		} else {
			for (const commit of commits) {
				const added = commit.added ?? [];
				const removed = commit.removed ?? [];
				const modified = commit.modified ?? [];
				const changes = GetGitlabChanges(
					project.path_with_namespace,
					commit.id,
					added,
					removed,
					modified
				);

				const subject = commit.message.split("\n")[0];
				const title = subject.length > 256 ? `${subject.substring(0, 250)}. . .` : subject;
				const commitBody = formatCommitBody(commit.message);

				const footer = `-# ${commit.id.substring(0, 6)} by ${commit.author.name}`;

				const container = new Discord.ContainerBuilder().setAccentColor(
					GetColorFromChanges(added.length, removed.length, modified.length)
				);

				const allFiles = [...added, ...modified, ...removed];
				includesLua =
					includesLua || (allFiles.length > 0 && allFiles.some(f => f.endsWith(".lua")));
				const isOnlyOgg = allFiles.length > 0 && allFiles.every(f => f.endsWith(".ogg"));

				const changeLines = buildChangeLines(changes);

				const diffFiles =
					isMergeCommit(commit.message) || isOnlyOgg
						? undefined
						: await getGitlabDiff(gitlab.api, project.id, commit.id);
				const diff = diffFiles?.length
					? formatDiffText(joinGitlabDiffFiles(diffFiles))
					: undefined;

				addContainerHeader(
					container,
					`[${repoLabel}](${repoUrl})`,
					`### [${title}](${commit.url})${commitBody}`,
					project.avatar_url ?? undefined
				);

				if (diff) {
					container.addSeparatorComponents(sep => sep);
					container.addTextDisplayComponents(text =>
						text.setContent(
							`\`\`\`diff\n${
								diff.length > DIFF_SIZE
									? diff.substring(0, DIFF_SIZE - 5) + ". . ."
									: diff
							}\`\`\``
						)
					);
				}

				if (changeLines.length > 0) {
					container.addSeparatorComponents(sep => sep);
					container.addTextDisplayComponents(text =>
						text.setContent(changeLines.join("\n"))
					);
				}

				container.addSeparatorComponents(sep => sep.setDivider(false));
				container.addTextDisplayComponents(text => text.setContent(footer));

				containers.push(container);
				commitShas.push(commit.id);
			}
		}

		const baseMessagePayload = <Discord.WebhookMessageCreateOptions>{
			...BaseEmbed,
			username: body.user_name,
			avatarURL: body.user_avatar,
			flags: Discord.MessageFlags.IsComponentsV2,
		};

		const actionRow:
			Discord.APIActionRowComponent<Discord.APIComponentInMessageActionRow> | undefined =
			includesLua
				? {
						type: Discord.ComponentType.ActionRow,
						components: [
							{
								type: Discord.ComponentType.Button,
								custom_id: "update",
								label: "Update Files on all Servers",
								style: 1,
							},
							{
								type: Discord.ComponentType.Button,
								custom_id: "everything",
								label: "Update and Refresh Files on all Servers",
								style: 1,
							},
						],
					}
				: undefined;

		if (containers.length > 1) {
			for (let i = 0; i < containers.length; i++) {
				const messageComponents: MessageComponent[] = [containers[i]];
				if (i === containers.length - 1 && actionRow) messageComponents.push(actionRow);

				const sha = commitShas[i];
				destWebhook
					.send({ ...baseMessagePayload, components: messageComponents })
					.then(msg => {
						if (sha) trackCommitMessage(sha, msg.id, messageComponents, containers[i]);
					})
					.catch(log.error.bind(log));
			}
		} else {
			const messageComponents: MessageComponent[] = [...containers];
			if (actionRow) messageComponents.push(actionRow);

			const sha = commitShas[0];
			destWebhook
				.send({ ...baseMessagePayload, components: messageComponents })
				.then(msg => {
					if (sha && containers[0])
						trackCommitMessage(sha, msg.id, messageComponents, containers[0]);
				})
				.catch(log.error.bind(log));
		}
	}

	async function GitlabMergeRequestHandler(body: WebhookMergeRequestEventSchema): Promise<void> {
		const mr = body.object_attributes;

		let action: string;
		switch (mr.action) {
			case "open":
				action = "opened";
				break;
			case "reopen":
				action = "reopened";
				break;
			case "close":
				action = "closed";
				break;
			case "merge":
				action = "merged";
				break;
			case "update":
				action = "updated";
				break;
			case "approved":
				action = "approved";
				break;
			case "unapproved":
				action = "unapproved";
				break;
			default:
				return;
		}

		const destWebhook = await getGitlabWebhook(mr.target_project_id);
		if (!destWebhook) return;

		const title = mr.title.length > 256 ? `${mr.title.substring(0, 250)}. . .` : mr.title;

		const diffFiles =
			mr.last_commit && !isMergeCommit(mr.last_commit.message)
				? await getGitlabDiff(gitlab.api, mr.target_project_id, mr.last_commit.id)
				: undefined;
		const changeLines = diffFiles
			? buildChangeLines(
					GetGitlabDiffChanges(
						mr.target.path_with_namespace,
						mr.last_commit.id,
						diffFiles
					)
				)
			: [];
		const diff = diffFiles?.length ? formatDiffText(joinGitlabDiffFiles(diffFiles)) : undefined;
		const mrBody = formatPrBody(mr.description);

		const added = diffFiles?.filter(f => f.new_file).length ?? 0;
		const removed = diffFiles?.filter(f => f.deleted_file).length ?? 0;
		const modified = (diffFiles?.length ?? 0) - added - removed;

		const container = new Discord.ContainerBuilder().setAccentColor(
			mr.action === "close"
				? 0xe74c3c
				: mr.action === "merge"
					? 0x8957e5
					: GetColorFromChanges(added, removed, modified)
		);

		const repoLine = `[${mr.target.path_with_namespace.substring(0, 256)}](${mr.target.web_url})`;
		const heading = `### [${title}](${mr.url})`;
		const diffContent = diff
			? `\`\`\`diff\n${
					diff.length > DIFF_SIZE ? diff.substring(0, DIFF_SIZE - 5) + ". . ." : diff
				}\`\`\``
			: "";
		const changeLinesContent = changeLines.join("\n");
		const footerContent = `-# MR !${mr.iid} ${action} by ${body.user.username}`;

		// The MR body is prioritised over the diff codeblock: if showing both would blow
		// past the Components V2 per-message text cap, drop the diff and keep the body.
		const showDiff =
			!!diffContent &&
			repoLine.length +
				heading.length +
				mrBody.length +
				diffContent.length +
				changeLinesContent.length +
				footerContent.length <=
				COMPONENT_TEXT_LIMIT;

		addContainerHeader(container, repoLine, heading, mr.target.avatar_url ?? undefined);

		if (mrBody) {
			container.addSeparatorComponents(sep => sep);
			container.addTextDisplayComponents(text => text.setContent(mrBody));
		}

		if (showDiff) {
			container.addSeparatorComponents(sep => sep);
			container.addTextDisplayComponents(text => text.setContent(diffContent));
		}

		if (changeLines.length > 0) {
			container.addSeparatorComponents(sep => sep);
			container.addTextDisplayComponents(text => text.setContent(changeLinesContent));
		}

		container.addSeparatorComponents(sep => sep.setDivider(false));
		container.addTextDisplayComponents(text => text.setContent(footerContent));

		const msg = await destWebhook
			.send({
				...BaseEmbed,
				username: body.user.name,
				avatarURL: body.user.avatar_url,
				components: [container],
				flags: Discord.MessageFlags.IsComponentsV2,
			})
			.catch(log.error.bind(log));

		if (msg && mr.last_commit)
			trackCommitMessage(mr.last_commit.id, msg.id, [container], container);
	}

	const GITLAB_TERMINAL_PIPELINE_STATUSES = new Set(["success", "failed", "canceled", "skipped"]);

	// Gitlab fires the pipeline hook on every status transition (pending, running, ...),
	// not just once at the end like Github's check_suite.completed, so only terminal
	// statuses are acted on here - otherwise every push would flood in-progress updates.
	async function GitlabPipelineHandler(body: WebhookPipelineEventSchema): Promise<void> {
		const pipe = body.object_attributes;
		const status = pipe.status;
		if (!GITLAB_TERMINAL_PIPELINE_STATUSES.has(status)) return;

		const project = body.project;
		const destWebhook = await getGitlabWebhook(project.id);
		if (!destWebhook) return;

		const tracked = commitMessages.get(pipe.sha);
		if (tracked) {
			upsertCheckLine(
				tracked,
				"pipeline",
				`${CHECK_CONCLUSION_EMOJI[status] ?? "⚪"} [Pipeline #${pipe.id}](${pipe.url}) ${status}`
			);
			await destWebhook
				.editMessage(tracked.messageId, {
					components: tracked.components,
					flags: Discord.MessageFlags.IsComponentsV2,
				})
				.catch(log.error.bind(log));
			return;
		}

		await destWebhook
			.send({
				...BaseEmbed,
				username: project.name,
				avatarURL: project.avatar_url ?? undefined,
				embeds: [
					{
						color: CHECK_CONCLUSION_COLOR[status] ?? 0x6a737d,
						title: `Pipeline ${status} on ${pipe.ref}`,
						url: pipe.url,
					},
				],
			})
			.catch(log.error.bind(log));
	}

	const gitlabHandlers: Record<string, (body: unknown) => Promise<void>> = {
		push: body => GitlabPushHandler(body as WebhookPushEventSchema),
		merge_request: body => GitlabMergeRequestHandler(body as WebhookMergeRequestEventSchema),
		pipeline: body => GitlabPipelineHandler(body as WebhookPipelineEventSchema),
	};
};
