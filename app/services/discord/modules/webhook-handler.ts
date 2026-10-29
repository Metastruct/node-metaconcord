import type {
	CommitDiffSchema,
	Gitlab as GitlabClient,
	WebhookMergeRequestEventSchema,
	WebhookPipelineEventSchema,
	WebhookPushEventSchema,
} from "@gitbeaker/rest";
import { type components } from "@octokit/openapi-types";
import type { Octokit } from "@octokit/rest";
import { createNodeMiddleware,Webhooks } from "@octokit/webhooks";
import { type EmitterWebhookEvent } from "@octokit/webhooks/types";
import axios from "axios";
import { diffChars } from "diff";
import * as Discord from "discord.js";
import express from "express";

import { clamp, errToMessage, logger, stripPrefix } from "#utils";
import { chatWebhook } from "#/app/services/gamebridge/games/gmod/webhooks.js";
import { type DiscordBot } from "../index.js";

import gitlabConfig from "#config/gitlab.json" with { type: "json" };
import webhookConfig from "#config/webhooks.json" with { type: "json" };

const log = logger(import.meta);

const COLOR_MOD = 75;
const COLOR_BASE = 50;

function GetColorFromChanges(added: number, removed: number, modified: number) {
	return (
		clamp(COLOR_BASE + COLOR_MOD * removed, COLOR_BASE, 255) * 65_536 +
		clamp(COLOR_BASE + COLOR_MOD * added, COLOR_BASE, 255) * 256 +
		clamp(COLOR_BASE + COLOR_MOD * modified, COLOR_BASE, 255)
	);
}

// Components V2 caps Text Display content at 4000 chars per message, and each
// commit/PR/MR is its own message, so the diff gets whatever is left over.
const BODY_SIZE = 300;
const PR_BODY_SIZE = 1500;
const MAX_COMMITS = 5;
const COMPONENT_TEXT_LIMIT = 4000;
const DIFF_SAFETY_MARGIN = 100;

function diffBudget(...parts: (string | undefined)[]): number {
	const used = parts.reduce((total, part) => total + (part?.length ?? 0), 0);
	return Math.max(0, COMPONENT_TEXT_LIMIT - used - DIFF_SAFETY_MARGIN);
}

const MinimalPushUsers = new Set(["MetaAutomator", "github-actions[bot]"]);

const CHECK_CONCLUSION_COLOR: Record<string, number> = {
	success: 0x28_A7_45,
	failure: 0xCB_24_31,
	failed: 0xCB_24_31, // Gitlab pipeline status spelling, as opposed to Github's "failure"
	timed_out: 0xCB_24_31,
	startup_failure: 0xCB_24_31,
	action_required: 0xDB_AB_09,
	cancelled: 0x6A_73_7D,
	canceled: 0x6A_73_7D, // Gitlab spelling
	skipped: 0x6A_73_7D,
	neutral: 0x6A_73_7D,
	stale: 0x6A_73_7D,
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
	in_progress: "🔁",
};

function getCheckTarget(pullRequests: { number: number }[], headBranch: string = "unknown branch"): string {
	return pullRequests.length > 0
		? `pull request #${pullRequests[0].number}`
		: (headBranch);
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

// multiple webhooks could trigger at once messing up the order
const editQueues = new Map<string, Promise<unknown>>();

function queueEdit(
	webhook: Discord.Webhook,
	messageId: string,
	components: MessageComponent[]
): Promise<unknown> {
	const prev = editQueues.get(messageId) ?? Promise.resolve();
	const next = prev
		.then(() =>
			webhook.editMessage(messageId, {
				components,
				flags: Discord.MessageFlags.IsComponentsV2,
			})
		)
		.catch(log.error.bind(log));
	editQueues.set(messageId, next);
	next.finally(() => {
		if (editQueues.get(messageId) === next) editQueues.delete(messageId);
	});
	return next;
}

// built lazily: webhooks.json's secret may be placeholder-empty on fresh
// clones / example configs and @octokit/webhooks throws on that at construct.
// @octokit/webhooks logs unhandled listener errors via its own default
// console-based logger, separate from our pino logger, which makes push/PR
// events that throw silently invisible in our normal logs. Route them here too.
let gitHubWebhooks: Webhooks | undefined;
const GitHub = (): Webhooks => {
	gitHubWebhooks ??= new Webhooks({ secret: webhookConfig.github.secret });
	gitHubWebhooks.onError(error => {
		log.error(
			{ err: error, name: error.event?.name, errors: error.errors },
			"Github webhook event handler failed"
		);
	});
	return gitHubWebhooks;
};

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
	return (
		text
			.replaceAll(/(@@ -\d+,\d+ .+\d+,\d+ @@)([^\n])/g, "$1\n$2")
			// binary diffs carry no ---/+++ headers, so synthesise them from the line
			.replaceAll(
				/^Binary files (.+) and (.+) differ$/gm,
				(_match, from: string, to: string) =>
					`--- ${from}\n+++ ${to}\nBinary files ${from} and ${to} differ`
			)
			.replaceAll("```", "\u{200B}`\u{200B}`\u{200B}`")
	);
}

const MAX_DIFF_CHANGES_PER_FILE = 8; // full body at/below this many changes
const MAX_DIFF_PEEK_CHANGES = 16; // changed lines shown across a larger file's hunks
const MAX_DIFF_LINE_LENGTH = 160; // lines longer than this get collapsed
const DIFF_CLIP_CONTEXT = 16; // unchanged chars kept either side of each change
const DIFF_BLOCK_OVERHEAD = "```diff\n".length + "\n```".length; // per-file fence

interface DiffFile {
	header: string[];
	body: string[];
	added: number;
	removed: number;
	maxChanges: number;
	path: string;
	oldPath?: string;
	renamed: boolean;
	binary: boolean;
	isNew: boolean;
	isDeleted: boolean;
	modeChanged: boolean;
}

const isChangedLine = (line: string) => line.startsWith("+") || line.startsWith("-");

const DIFF_METADATA_PREFIXES = [
	"index ",
	"similarity index ",
	"rename from ",
	"rename to ",
	"copy from ",
	"copy to ",
	"new file mode ",
	"deleted file mode ",
	"old mode ",
	"new mode ",
];
const isDiffMetadata = (line: string) =>
	DIFF_METADATA_PREFIXES.some(prefix => line.startsWith(prefix));

// "diff --git a/foo b/bar", where git quotes paths containing spaces etc.
function parseGitDiffPaths(line: string): [string | undefined, string | undefined] {
	const tokens: string[] = [];
	const re = /"((?:[^"\\]|\\.)*)"|(\S+)/g;
	let match: RegExpExecArray | null;
	while ((match = re.exec(line.slice("diff --git ".length))) !== null) {
		tokens.push(match[1] ?? match[2]);
	}
	return [stripPrefix(tokens[0], "a/"), stripPrefix(tokens[1], "b/")];
}

function parseDiffFiles(text: string): DiffFile[] {
	const files: DiffFile[] = [];
	let header: string[] = [];
	let body: string[] = [];
	let gitFrom: string | undefined;
	let gitTo: string | undefined;
	let renameFrom: string | undefined;
	let renameTo: string | undefined;
	let modeChanged = false;

	const flush = () => {
		if (
			gitFrom === undefined &&
			renameFrom === undefined &&
			header.length === 0 &&
			body.length === 0
		) {
			return;
		}
		const added = body.filter(l => l.startsWith("+")).length;
		const removed = body.filter(l => l.startsWith("-")).length;
		const isNew = header.some(l => /^--- \/dev\/null$/.test(l));
		const isDeleted = header.some(l => /^\+\+\+ \/dev\/null$/.test(l));
		const headerPath = (prefix: string) =>
			header
				.find(l => l.startsWith(prefix) && !l.includes("/dev/null"))
				?.slice(4)
				.replace(/^[ab]\//, "")
				.trim();
		const newPath = headerPath("+++ ") ?? renameTo ?? gitTo;
		const oldPath = headerPath("--- ") ?? renameFrom ?? gitFrom;
		// prefer the new path so renames match the linked change list
		const path = newPath ?? oldPath ?? "unknown";
		const renamed = !!newPath && !!oldPath && newPath !== oldPath;
		const binary = body.some(l => l.startsWith("Binary files "));
		files.push({
			header,
			body,
			added,
			removed,
			maxChanges: Math.max(added, removed),
			path,
			oldPath,
			renamed,
			binary,
			isNew,
			isDeleted,
			modeChanged,
		});
		header = [];
		body = [];
		gitFrom = undefined;
		gitTo = undefined;
		renameFrom = undefined;
		renameTo = undefined;
		modeChanged = false;
	};

	// a file header is only a "--- old" line immediately followed by "+++ new";
	// deleted content can also start with "---" (e.g. a Lua comment "-- x").
	const lines = text.split("\n");
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (line.startsWith("diff --git ")) {
			// every git file section starts here, so it's the only reliable
			// boundary for sections without ---/+++ (renames, mode changes)
			flush();
			[gitFrom, gitTo] = parseGitDiffPaths(line);
			continue;
		}
		if (line.startsWith("--- ") && lines[i + 1]?.startsWith("+++ ")) {
			if (header.length > 0 || body.length > 0) flush();
			header.push(line, lines[i + 1]);
			i++;
			continue;
		}
		const fromMatch = /^(?:rename|copy) from (.+)$/.exec(line);
		if (fromMatch) {
			renameFrom = fromMatch[1].trim();
			continue;
		}
		const toMatch = /^(?:rename|copy) to (.+)$/.exec(line);
		if (toMatch) {
			renameTo = toMatch[1].trim();
			continue;
		}
		if (line.startsWith("old mode ") || line.startsWith("new mode ")) {
			modeChanged = true;
			continue;
		}
		if (isDiffMetadata(line)) continue;
		body.push(line);
	}
	flush();
	return files;
}

// Label naming a file (linked when we have a change-list line) and its counts.
function diffLabel(file: DiffFile, shownChanges: number, link?: string): string {
	let name = link ?? `\`${file.path}\``;
	if (file.renamed && file.oldPath) {
		const renamed = `${file.oldPath} → ${file.path}`;
		name = link ? link.replace(/\[[^\]]*\]/, `[${renamed}]`) : `\`${renamed}\``;
	}
	const notes: string[] = [];
	if (file.binary) notes.push("binary");
	if (file.modeChanged) notes.push("mode");
	if (shownChanges < file.maxChanges) notes.push(`showing ${shownChanges}`);
	const suffix = notes.length > 0 ? ` (${notes.join(", ")})` : "";
	if (file.binary) return `${name}${suffix}`;
	if (file.isNew) return `${name} +${file.added}${suffix}`;
	if (file.isDeleted) return `${name} -${file.removed}${suffix}`;
	// a pure rename / mode change has nothing to count, so don't show "+0 -0"
	if (file.added === 0 && file.removed === 0 && (file.renamed || file.modeChanged))
		return `${name}${suffix}`;
	return `${name} +${file.added} -${file.removed}${suffix}`;
}

interface DiffBlock {
	file: DiffFile;
	content: string[];
	contentCost: number;
	isLarge: boolean;
}

interface DiffRegion {
	oldStart: number;
	oldEnd: number;
	newStart: number;
	newEnd: number;
}

// Character-level diff of a removed/added line pair, merged into the spans that
// actually changed - so a long line edited in several places yields several
// regions rather than one span from the first edit to the last.
function differingRegions(oldBody: string, newBody: string): DiffRegion[] {
	const regions: DiffRegion[] = [];
	let oldPos = 0;
	let newPos = 0;
	let current: DiffRegion | undefined;
	for (const part of diffChars(oldBody, newBody)) {
		const length = part.value.length;
		if (part.added || part.removed) {
			current ??= { oldStart: oldPos, oldEnd: oldPos, newStart: newPos, newEnd: newPos };
			if (part.removed) oldPos += length;
			if (part.added) newPos += length;
			current.oldEnd = oldPos;
			current.newEnd = newPos;
		} else {
			if (current) {
				regions.push(current);
				current = undefined;
			}
			oldPos += length;
			newPos += length;
		}
	}
	if (current) regions.push(current);
	return regions;
}

// Collapses the runs of a long line that didn't change to "…", keeping a little
// context around every changed region so multiple edits all stay visible.
function collapseLine(body: string, regions: [number, number][]): string {
	const keep = new Array<boolean>(body.length).fill(false);
	for (const [start, end] of regions) {
		const from = Math.max(0, start - DIFF_CLIP_CONTEXT);
		const to = Math.min(body.length, end + DIFF_CLIP_CONTEXT);
		for (let i = from; i < to; i++) keep[i] = true;
	}

	let out = "";
	let gap = false;
	let i = 0;
	while (i < body.length) {
		if (keep[i]) {
			if (gap) {
				out += "…";
				gap = false;
			}
			let end = i;
			while (end < body.length && keep[end]) end++;
			out += body.slice(i, end);
			i = end;
		} else {
			gap = true;
			i++;
		}
	}
	if (gap) out += "…";
	return out.length > MAX_DIFF_LINE_LENGTH ? `${out.slice(0, MAX_DIFF_LINE_LENGTH - 1)}…` : out;
}

// Keeps an over-long line to just its changed parts, still showing the leading
// diff marker (+/-/space) so a collapsed line doesn't read as context.
function clipDiffLine(line: string, regions: [number, number][]): string {
	if (line.length <= MAX_DIFF_LINE_LENGTH) return line;

	const marker = line[0];
	const body = line.slice(1);
	// no counterpart to diff against: fall back to showing the head of the line
	if (regions.length === 0) return `${marker}${body.slice(0, MAX_DIFF_LINE_LENGTH - 1)}…`;
	return `${marker}${collapseLine(body, regions)}`;
}

// Pairs each removed line with its added counterpart so the changed regions
// within both can be located, then collapses every over-long line.
function clipDiffLines(content: string[]): string[] {
	const regions: ([number, number][] | undefined)[] = new Array(content.length).fill(undefined);
	let i = 0;
	while (i < content.length) {
		// a change group runs while we keep seeing +/- lines (and the "\ No newline"
		// marker, which git may interleave between the removed and added line)
		const startsChange =
			content[i].startsWith("-") ||
			content[i].startsWith("+") ||
			content[i].startsWith("\\");
		if (!startsChange) {
			i++;
			continue;
		}
		const removed: number[] = [];
		const added: number[] = [];
		while (i < content.length) {
			const line = content[i];
			if (line.startsWith("-")) removed.push(i);
			else if (line.startsWith("+")) added.push(i);
			else if (!line.startsWith("\\")) break;
			i++;
		}
		for (const [removedElement, addedElement] of Iterator.zip([removed, added])) {
			const oldBody = content[removedElement].slice(1);
			const newBody = content[addedElement].slice(1);
			if (oldBody.length <= MAX_DIFF_LINE_LENGTH && newBody.length <= MAX_DIFF_LINE_LENGTH)
				continue;
			const diff = differingRegions(oldBody, newBody);
			regions[removedElement] = diff.map(r => [r.oldStart, r.oldEnd]);
			regions[addedElement] = diff.map(r => [r.newStart, r.newEnd]);
		}
	}
	return content.map((line, index) => clipDiffLine(line, regions[index] ?? []));
}

// A file's body is a sequence of hunks, each starting at its "@@ ... @@" header.
function splitHunks(body: string[]): string[][] {
	const hunks: string[][] = [];
	let current: string[] = [];
	for (const line of body) {
		if (line.startsWith("@@") && current.length > 0) {
			hunks.push(current);
			current = [];
		}
		current.push(line);
	}
	if (current.length > 0) hunks.push(current);
	return hunks;
}

// Shares the changed-line budget across a file's hunks so every part of a large
// diff is represented instead of only the top of the file. A hunk that needs
// less than its share spills the rest over to the others.
function hunkQuotas(hunks: string[][], budget: number): number[] {
	const counts = hunks.map(hunk => hunk.filter(isChangedLine).length);
	const quotas = new Array<number>(hunks.length).fill(0);
	let remaining = budget;
	for (let i = 0; i < hunks.length && remaining > 0; i++) {
		if (counts[i] > 0) {
			quotas[i] = 1;
			remaining--;
		}
	}
	while (remaining > 0) {
		let progressed = false;
		for (let i = 0; i < hunks.length && remaining > 0; i++) {
			if (quotas[i] < counts[i]) {
				quotas[i]++;
				remaining--;
				progressed = true;
			}
		}
		if (!progressed) break;
	}
	return quotas;
}

// For a large file, keeps up to the budget's changed lines from each hunk (with
// the context leading up to them), marking any hunk that had to be cut short.
function peekHunks(body: string[], budget: number): string[] {
	const hunks = splitHunks(body);
	const quotas = hunkQuotas(hunks, budget);
	const content: string[] = [];
	for (const [h, hunk] of hunks.entries()) {
		if (quotas[h] === 0) continue;
		let shown = 0;
		let i = 0;
		for (; i < hunk.length; i++) {
			content.push(hunk[i]);
			if (isChangedLine(hunk[i]) && ++shown >= quotas[h]) {
				i++;
				break;
			}
		}
		if (i < hunk.length) content.push("…");
	}
	return content;
}

// Small files keep their full body; larger ones get a bounded, hunk-fair peek so
// they can't starve the block and later changes aren't hidden by churn up top.
function buildDiffBlocks(files: DiffFile[]): DiffBlock[] {
	return files.map(file => {
		const isLarge = file.maxChanges > MAX_DIFF_CHANGES_PER_FILE;
		const content = clipDiffLines(
			isLarge ? peekHunks(file.body, MAX_DIFF_PEEK_CHANGES) : file.body
		);
		return {
			file,
			content,
			contentCost: DIFF_BLOCK_OVERHEAD + content.reduce((n, line) => n + line.length + 1, 0),
			isLarge,
		};
	});
}

// When a file can't fit its share, takes a slice from each of its hunks rather
// than just the head, so the budget doesn't always eat the last hunk. Returns
// the lines to show, with "…" marking where a hunk was cut short.
function sampleBlock(content: string[], budget: number): string[] {
	const hunks = splitHunks(content).filter(hunk => hunk.some(isChangedLine));
	if (hunks.length === 0) return [];

	let remaining = budget - DIFF_BLOCK_OVERHEAD;
	const allocated = new Array<number>(hunks.length).fill(0);
	const whole = new Array<boolean>(hunks.length).fill(false);
	const pending = hunks.map((_, i) => i);
	while (remaining > 0 && pending.length > 0) {
		const share = Math.floor(remaining / pending.length);
		if (share <= 1) break;
		let progressed = false;
		for (let p = pending.length - 1; p >= 0; p--) {
			const i = pending[p];
			const cost = hunks[i].reduce((n, line) => n + line.length + 1, 0);
			if (cost <= share) {
				allocated[i] = cost;
				whole[i] = true;
				remaining -= cost;
				pending.splice(p, 1);
				progressed = true;
			}
		}
		if (progressed) continue;
		for (const i of pending) allocated[i] = share;
		break;
	}

	const shown: string[] = [];
	for (const [i, hunk] of hunks.entries()) {
		if (allocated[i] <= 0) continue;
		// a hunk that fits is shown in full; one that doesn't keeps its header and
		// changed lines, dropping context so the budget buys changes, not boilerplate
		if (whole[i]) {
			shown.push(...hunk);
			continue;
		}
		let used = 0;
		let gap = false;
		for (const line of hunk) {
			if (!isChangedLine(line) && !line.startsWith("@@")) {
				gap = true;
				continue;
			}
			if (used + line.length + 1 > allocated[i]) break;
			if (gap) {
				if (shown.at(-1) !== "…") shown.push("…");
				gap = false;
			}
			shown.push(line);
			used += line.length + 1;
		}
		if (gap && shown.at(-1) !== "…") shown.push("…");
	}
	return shown;
}

// Renders each file as its own ```diff block under a subtext label. Fits into
// `budget` chars, keeping every label + fence and sharing the rest fairly, so one
// big diff can't push the others out. Callers place the result in one TextDisplay.
function formatDiff(text: string, budget: number, links?: Map<string, string>): string {
	const files = parseDiffFiles(text);
	if (files.length === 0) return "";
	const blocks = buildDiffBlocks(files);

	// Every file keeps its label; only the diff content is budgeted, so a big
	// diff never hides the fact that a file changed.
	const labelCost = () => blocks.reduce(
		(n, block) => n + diffLabel(block.file, 0, links?.get(block.file.path)).length + 1,
		0);

	// Only shed files if there are so many that even the labels don't fit.
	let dropped = 0;
	while (blocks.length > 1 && labelCost() > budget) {
		blocks.pop();
		dropped++;
	}
	if (labelCost() > budget) return "";

	const shown: string[][] = blocks.map(() => []);
	let remaining = budget - labelCost();
	const pending = blocks.map((_, i) => i).filter(i => blocks[i].content.length > 0);

	// Water-filling: equal share per file, leftovers flow to the bigger ones.
	while (pending.length > 0 && remaining > 0) {
		const share = Math.floor(remaining / pending.length);
		if (share <= 0) break;

		let progressed = false;
		for (let p = pending.length - 1; p >= 0; p--) {
			const i = pending[p];
			if (blocks[i].contentCost <= share) {
				shown[i] = blocks[i].content;
				remaining -= blocks[i].contentCost;
				pending.splice(p, 1);
				progressed = true;
			}
		}
		if (progressed) continue;

		// Nothing fits whole: give each remaining file a slice spread across its
		// hunks instead of its head, so the budget doesn't always eat the tail.
		for (const i of pending) shown[i] = sampleBlock(blocks[i].content, share);
		break;
	}

	const rendered = blocks
		.map((block, i) => {
			const changed = shown[i].filter(isChangedLine).length;
			// don't open a block for context-only output; just show the label
			const label = diffLabel(
				block.file,
				changed > 0 ? changed : block.file.maxChanges,
				links?.get(block.file.path)
			);
			return changed > 0
				? `${label}\n\`\`\`diff\n${shown[i].join("\n")}\n\`\`\``
				: label;
		})
		.join("\n");

	const note = dropped > 0 ? `... and ${dropped} more file${dropped > 1 ? "s" : ""}` : "";
	return [rendered, note].filter(Boolean).join("\n");
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
	} catch (error) {
		log.error({ err: error, owner, repo, ref }, "failed to fetch Github commit diff");
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
	} catch (error) {
		log.error({ err: error, owner, repo, pull_number }, "failed to fetch Github PR diff");
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
	} catch (error) {
		log.error({ err: error, prApiUrl }, "failed to fetch PR files from Github");
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
	} catch (error) {
		log.error({ err: error, id, sha }, "failed to fetch Gitlab diff");
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
		const prefix = f.new_file ? "+" : (f.deleted_file ? "\\-" : "~");
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
		.map(f => {
			// binary diffs have no hunks; formatDiffText synthesises their headers
			if (f.diff.startsWith("Binary files")) return f.diff;
			// match Github's a/ b/ headers so formatDiff strips them and detects new/deleted
			const oldPath = f.new_file ? "/dev/null" : `a/${f.old_path}`;
			const newPath = f.deleted_file ? "/dev/null" : `b/${f.new_path}`;
			return `--- ${oldPath}\n+++ ${newPath}\n${f.diff}`;
		})
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

const REF_BRANCH_REGEX = /^[^/]*\/[^/]*\/(?<branch>.*)$/;

/** something like 'refs/heads/master' -> extracts 'master' */
function getBranchByRef(ref: string) {
	return ref.match(REF_BRANCH_REGEX).groups.branch;
}

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

// The change-list lines ("+ [path](url)") already link each file, so they double
// as the diff labels and the separate list can go away. Keyed by repo path.
function linkByPath(changes: string[]): Map<string, string> {
	const links = new Map<string, string>();
	for (const change of changes) {
		const path = /^\S+ \[(.+?)\]\(/.exec(change)?.[1];
		if (path) links.set(path, change);
	}
	return links;
}

function GetPullRequestChanges(files: components["schemas"]["diff-entry"][]): string[] {
	return files.map(f => {
		// leading "-" is escaped: unescaped, Discord renders a line starting with
		// "- " as a markdown list bullet instead of a literal minus sign
		const prefix = f.status === "added" ? "+" : (f.status === "removed" ? "\\-" : "~");
		return `${prefix} [${f.filename}](${f.blob_url})`;
	});
}

function formatCommitBody(message: string): string {
	const body = message.split("\n").slice(1).join("\n").trim();
	if (!body) return "";

	const truncated = body.length > BODY_SIZE ? `${body.slice(0, Math.max(0, BODY_SIZE - 3))}...` : body;
	return "\n" + truncated.replaceAll(/^/gm, "> ");
}

function formatPrBody(body?: string | null): string {
	const trimmed = body?.trim();
	if (!trimmed) return "";
	const truncated =
		trimmed.length > PR_BODY_SIZE ? `${trimmed.slice(0, Math.max(0, PR_BODY_SIZE - 3))}...` : trimmed;
	return truncated.replaceAll(/^/gm, "> ");
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

export default async function WebhookHandlerLoader(bot: DiscordBot): Promise<void> {
	const webapp = bot.container.getService("WebApp");

	const middleware = createNodeMiddleware(GitHub(), { path: "/" });

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

		gitlabHandler(req.body).catch(error =>
			log.error({ err: error, eventKind }, "Gitlab webhook event handler failed")
		);
	});

	let webhook: Discord.Webhook;
	// all soft requirements, relay/button features just don't fire when these are disabled
	const bridge = bot.container.tryService("GameBridge");

	const github = bot.container.tryService("Github");
	const gitlab = bot.container.tryService("Gitlab");

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
			if (!channel) return;

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
		if (!channel) return;

		const hooks = await channel.fetchWebhooks();
		const botHook = hooks.filter(h => h.owner === bot.discord.user).first();
		if (botHook) {
			webhook = botHook;
		} else {
			webhook = await channel.createWebhook({
				name: "Public Commits",
				reason: "Webhook missing?",
			});
		}
		webhooksByChannel.set(bot.config.channels.publicCommits, Promise.resolve(webhook));
	});

	const allowedRoles = new Set([
		bot.config.roles.developer,
		bot.config.roles.trialDeveloper,
		bot.config.roles.administrator,
	]);

	bot.discord.on("interactionCreate", async (ctx: Discord.Interaction<Discord.CacheType>) => {
		if (!bridge || !ctx.member || !ctx.isButton()) return;
		const [action, override] = ctx.customId.split("_", 2);
		const where =
			override === undefined
				? bridge.servers.gmod.filter(s => !!s)
				: bridge.servers.gmod.filter(s =>
					override.split(",").includes(s.config.id.toString())
				);

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
						.join(",")}...`
				);
				await Promise.all(
					where.map(async server => {
						await server
							.runGserv("qu rehash")
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
										.join(",")
							}!`
						);
					})
					.catch(error => {
						ctx.editReply(
							`<@${ctx.user.id}> something went wrong :(\`\`\`\n${error}\`\`\``
						);
						log.error(error);
					});
				break;
			case "everything": {
				await ctx.deferReply();
				const msg = ctx.message;
				const url =
					msg.embeds.length > 0
						? msg.embeds.at(-1).url
						: findCommitUrl(msg);
				if (!url) {
					await ctx.editReply("url not found for refreshing :( ... aborting");
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
						if (!github) {
							await ctx.editReply(
								"github is not enabled on this instance :( ... aborting"
							);
							return;
						}
						const res = await github.octokit.rest.repos.getCommit({ owner, repo, ref });
						files = res.data.files?.flatMap(f => f.filename);
					} catch (error: unknown) {
						await ctx.editReply(
							"something went wrong fetching the files from github :( ... aborting\n" +
								`\`${errToMessage(error)}\``
						);
						log.error(
							{ err: error, context: { url, owner, repo, ref } },
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
						if (!gitlab) {
							await ctx.editReply(
								"gitlab is not enabled on this instance :( ... aborting"
							);
							return;
						}
						const diffs = await getGitlabDiff(gitlab.api, id, sha);
						files = diffs?.filter(f => !f.deleted_file).flatMap(f => f.new_path);
					} catch (error: unknown) {
						await ctx.editReply(
							"something went wrong fetching the files from gitlab :( ... aborting\n" +
								`\`${errToMessage(error)}\``
						);
						log.error(
							{
								err: error,
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
					await ctx.editReply("no files found for refreshing :( ... aborting");
					return;
				}

				await ctx.editReply(
					`<@${ctx.user.id}> updating and refreshing files on ${where
						.map(s =>
							s.discord.ready ? `<@${s.discord.user?.id}>` : `#${s.config.id}`
						)
						.join(",")}...`
				);

				await Promise.all(
					where.map(async server => {
						const reply = await ctx.fetchReply();

						await server.runGserv("qu rehash").then(async () => {
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
										.join(",")
							} and refreshed files!`
						);
					})
					.catch(error => {
						ctx.editReply(
							`<@${ctx.user.id}> something went wrong :(\`\`\`\n${error}\`\`\``
						);
						log.error(error);
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
		const branch = getBranchByRef(payload.ref);

		let includesLua = false;

		const containers: Discord.ContainerBuilder[] = [];
		// parallel to `containers`; the commit sha each container's message should be
		// tracked under so a later check_run/check_suite completion can edit it in place
		const commitShas: (string | undefined)[] = [];

		const onDefaultBranch = branch === repo.default_branch;
		const repoLabel = onDefaultBranch
			? repo.name.slice(0, 256)
			: (repo.name + "/" + branch).slice(0, 256);
		const repoUrl = onDefaultBranch
			? repo.html_url
			: `${repo.html_url}/tree/${branch.split("/").map(encodeURIComponent).join("/")}`;

		if (payload.head_commit && isRemoteMergeCommit(payload.head_commit.message))
			commits.splice(0, commits.length, payload.head_commit);

		if (commits.length > MAX_COMMITS) {
			const container = new Discord.ContainerBuilder().setAccentColor(0xFF_D7_00);

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
			commitShas.push(payload.head_commit?.id ?? commits.at(-1)?.id);
		} else {
			for (const commit of commits) {
				const changes = GetGithubChanges(
					repo.full_name,
					commit.id,
					commit.added,
					commit.removed,
					commit.modified
				);

				const subject = commit.message.split("\n", 1)[0];
				const title = subject.length > 256 ? `${subject.slice(0, 250)}. . .` : subject;
				const body = formatCommitBody(commit.message);

				const footer = `-# ${commit.id.slice(0, 6)} by ${
					commit.author.username ?? commit.author.name
				}${
					commit.author.name === commit.committer.name
						? ""
						: ` via ${commit.committer.username ?? commit.committer.name}`
				}`;

				const container = new Discord.ContainerBuilder().setAccentColor(
					GetColorFromChanges(
						commit.added?.length ?? 0,
						commit.removed?.length ?? 0,
						commit.modified?.length ?? 0
					)
				);

				if (MinimalPushUsers.has(payload.sender?.login || payload.pusher.name)) {
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

				includesLua = allFiles.some(str => str.endsWith(".lua"));

				const isOnlyOgg =
					allFiles.length > 0 && allFiles.every(str => str.endsWith(".ogg"));

				const diff =
					isOnlyOgg || !github || !repo.owner || isMergeCommit(commit.message)
						? undefined
						: await getGitHubCommitDiff(
							github.octokit,
							repo.owner.login,
							repo.name,
							commit.id
						);

				const repoLine = `[${repoLabel}](${repoUrl})`;
				const heading = `### [${title}](${commit.url})${body}`;

				addContainerHeader(container, repoLine, heading, repo.owner?.avatar_url);

				const diffBody = diff
					? formatDiff(diff, diffBudget(repoLine, heading, footer), linkByPath(changes))
					: undefined;
				if (diffBody) {
					container.addSeparatorComponents(sep => sep);
					container.addTextDisplayComponents(text => text.setContent(diffBody));
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
					custom_id: serverOverride ? `update_${serverOverride.join(",")}` : "update",
					label: serverOverride
						? `Update Files on ${serverOverride.map(s => `#${s}`).join(",")}`
						: "Update Files on all Servers",
					style: 1,
				},
				{
					type: Discord.ComponentType.Button,
					custom_id: serverOverride
						? `everything_${serverOverride.join(",")}`
						: "everything",
					label: serverOverride
						? `Update and Refresh Files on ${serverOverride.map(s => `#${s}`).join(",")}`
						: "Update and Refresh Files on all Servers",
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
				if (includesLua && i === containers.length - 1) messageComponents.push(actionRow);

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
			const [soundFolder, _chatsounds, _autoadd, folderName, soundName] = path.split("/", 5);
			if (soundFolder !== "sound" || !folderName || !soundName) return map;
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
					`-# added by ${commit.author.username ?? commit.author.name} via \`${commit.message.split("\n\n", 1)[0]}\`, approved by ${payload.pusher.username ?? payload.pusher.name}`
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

		const sha = payload.head_commit?.id ?? commits.at(-1)?.id;
		webhook
			.send(message)
			.then(msg => {
				if (sha) trackCommitMessage(sha, msg.id, messageComponents, container);
			})
			.catch(log.error.bind(log));
		chatWebhook()
			.send({ ...message, withComponents: true })
			.catch(log.error.bind(log));
	}

	GitHub().on("push", async event => {
		if (!webhook) return;

		if (bridge) {
			const payload = event.payload;
			const branchName = getBranchByRef(payload.ref);
			bridge.events.emit("githubPush", {
				repo: payload.repository.full_name,
				branch: branchName,
				commits: payload.commits.map(c => ({
					author: c.author.username ?? c.author.name,
					message: c.message.split("\n", 1)[0],
					hash: c.id.slice(0, 12),
				})),
			});
		}

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

		container.setAccentColor(payload.pull_request.state === "open" ? 5_763_719 : 15_277_667);

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

		const title = pr.title.length > 256 ? `${pr.title.slice(0, 250)}. . .` : pr.title;

		const diff = github
			? await getGitHubPullRequestDiff(github.octokit, repo.owner.login, repo.name, pr.number)
			: undefined;

		const files = await getPullRequestFiles(pr.url);
		const links = files ? linkByPath(GetPullRequestChanges(files)) : undefined;
		const prBody = formatPrBody(pr.body);

		const container = new Discord.ContainerBuilder().setAccentColor(
			payload.action === "closed"
				? (pr.merged
					? 0x89_57_E5
					: 0xE7_4C_3C)
				: GetColorFromChanges(pr.additions ?? 0, pr.deletions ?? 0, pr.changed_files ?? 0)
		);

		const repoLine = `-# [${repo.full_name.slice(0, 256)}](${repo.html_url})`;
		const heading = `### [${title}](${pr.html_url})`;
		const footerContent = `-# PR #${pr.number} ${action} by ${payload.sender.login ?? "unknown"}`;

		// Keep the body whole and shrink the diff to fit, rather than dropping it.
		const diffBody = diff
			? formatDiff(diff, diffBudget(repoLine, heading, prBody, footerContent), links)
			: "";
		addContainerHeader(container, repoLine, heading, repo.owner?.avatar_url);

		if (prBody) {
			container.addSeparatorComponents(sep => sep);
			container.addTextDisplayComponents(text => text.setContent(prBody));
		}

		if (diffBody) {
			container.addSeparatorComponents(sep => sep);
			container.addTextDisplayComponents(text => text.setContent(diffBody));
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

	GitHub().on("pull_request", async event => {
		if (!webhook) return;

		if (bridge) {
			const payload = event.payload;
			const pr = payload.pull_request;
			type PrAction = "opened" | "reopened" | "closed" | "merged" | "ready_for_review";
			const actionMap: Partial<Record<string, PrAction>> = {
				opened: "opened",
				reopened: "reopened",
				ready_for_review: "ready_for_review",
				closed: pr.merged ? "merged" : "closed",
			};
			const action = actionMap[payload.action];
			if (action) {
				bridge.events.emit("githubPullRequest", {
					repo: payload.repository.full_name,
					action,
					number: pr.number,
					title: pr.title,
					author: payload.sender?.login ?? "unknown",
					branch: pr.head.ref,
					baseBranch: pr.base.ref,
					url: pr.html_url,
				});
			}
		}

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

	GitHub().on("workflow_run.in_progress", async event => {
		if (!webhook) return;
		const payload = event.payload;
		const run = payload.workflow_run;
		if (run.status !== "in_progress") return;

		const name = run.name ?? "Workflow";

		const tracked = commitMessages.get(run.head_sha);
		if (!tracked) return;

		upsertCheckLine(
			tracked,
			`run:${run.id}`,
			`${CHECK_CONCLUSION_EMOJI.in_progress ?? "🔁"} [${name}](${run.html_url}) in progress`
		);
		queueEdit(webhook, tracked.messageId, tracked.components);
	});

	GitHub().on("workflow_run.completed", async event => {
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
			queueEdit(webhook, tracked.messageId, tracked.components);
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
						color: CHECK_CONCLUSION_COLOR[conclusion] ?? 0x6A_73_7D,
						title: `${name} ${conclusion} on ${target}`,
						url: run.html_url,
					},
				],
			})
			.catch(log.error.bind(log));
	});

	GitHub().on("organization", async event => {
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

	GitHub().on("membership", async event => {
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

	GitHub().on("team", async event => {
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
			? project.path_with_namespace.slice(0, 256)
			: (project.path_with_namespace + "/" + branch).slice(0, 256);
		const repoUrl = onDefaultBranch
			? project.web_url
			: `${project.web_url}/-/tree/${branch.split("/").map(encodeURIComponent).join("/")}`;

		let includesLua = false;
		const containers: Discord.ContainerBuilder[] = [];
		const commitShas: (string | undefined)[] = [];

		if (commits.length > MAX_COMMITS) {
			const container = new Discord.ContainerBuilder().setAccentColor(0xFF_D7_00);

			addContainerHeader(
				container,
				`[${repoLabel}](${repoUrl})`,
				`### ${commits.length} commits in this push\n[View all changes](${project.web_url}/-/compare/${body.before}...${body.after})`,
				project.avatar_url ?? undefined
			);
			container.addTextDisplayComponents(text => text.setContent(`-# by ${body.user_name}`));

			containers.push(container);
			commitShas.push(body.checkout_sha || commits.at(-1)?.id);
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

				const subject = commit.message.split("\n", 1)[0];
				const title = subject.length > 256 ? `${subject.slice(0, 250)}. . .` : subject;
				const commitBody = formatCommitBody(commit.message);

				const footer = `-# ${commit.id.slice(0, 6)} by ${commit.author.name}`;

				const container = new Discord.ContainerBuilder().setAccentColor(
					GetColorFromChanges(added.length, removed.length, modified.length)
				);

				const allFiles = [...added, ...modified, ...removed];
				includesLua ||= allFiles.some(f => f.endsWith(".lua"));
				const isOnlyOgg = allFiles.length > 0 && allFiles.every(f => f.endsWith(".ogg"));

				const diffFiles =
					isOnlyOgg || !gitlab || isMergeCommit(commit.message)
						? undefined
						: await getGitlabDiff(gitlab.api, project.id, commit.id);
				const diff = diffFiles?.length
					? formatDiffText(joinGitlabDiffFiles(diffFiles))
					: undefined;

				const repoLine = `[${repoLabel}](${repoUrl})`;
				const heading = `### [${title}](${commit.url})${commitBody}`;

				addContainerHeader(container, repoLine, heading, project.avatar_url ?? undefined);

				const diffBody = diff
					? formatDiff(diff, diffBudget(repoLine, heading, footer), linkByPath(changes))
					: undefined;
				if (diffBody) {
					container.addSeparatorComponents(sep => sep);
					container.addTextDisplayComponents(text => text.setContent(diffBody));
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
				if (actionRow && i === containers.length - 1) messageComponents.push(actionRow);

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

		const title = mr.title.length > 256 ? `${mr.title.slice(0, 250)}. . .` : mr.title;

		const diffFiles =
			gitlab && mr.last_commit && !isMergeCommit(mr.last_commit.message)
				? await getGitlabDiff(gitlab.api, mr.target_project_id, mr.last_commit.id)
				: undefined;
		const links = diffFiles
			? linkByPath(
				GetGitlabDiffChanges(
					mr.target.path_with_namespace,
					mr.last_commit.id,
					diffFiles
				)
			)
			: undefined;
		const diff = diffFiles?.length ? formatDiffText(joinGitlabDiffFiles(diffFiles)) : undefined;
		const mrBody = formatPrBody(mr.description);

		const added = diffFiles?.filter(f => f.new_file).length ?? 0;
		const removed = diffFiles?.filter(f => f.deleted_file).length ?? 0;
		const modified = (diffFiles?.length ?? 0) - added - removed;

		const container = new Discord.ContainerBuilder().setAccentColor(
			mr.action === "close"
				? 0xE7_4C_3C
				: (mr.action === "merge"
					? 0x89_57_E5
					: GetColorFromChanges(added, removed, modified))
		);

		const repoLine = `[${mr.target.path_with_namespace.slice(0, 256)}](${mr.target.web_url})`;
		const heading = `### [${title}](${mr.url})`;
		const footerContent = `-# MR !${mr.iid} ${action} by ${body.user.username}`;

		// Keep the body whole and shrink the diff to fit, rather than dropping it.
		const diffBody = diff
			? formatDiff(diff, diffBudget(repoLine, heading, mrBody, footerContent), links)
			: "";
		addContainerHeader(container, repoLine, heading, mr.target.avatar_url ?? undefined);

		if (mrBody) {
			container.addSeparatorComponents(sep => sep);
			container.addTextDisplayComponents(text => text.setContent(mrBody));
		}

		if (diffBody) {
			container.addSeparatorComponents(sep => sep);
			container.addTextDisplayComponents(text => text.setContent(diffBody));
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
			queueEdit(destWebhook, tracked.messageId, tracked.components);
			return;
		}

		await destWebhook
			.send({
				...BaseEmbed,
				username: project.name,
				avatarURL: project.avatar_url ?? undefined,
				embeds: [
					{
						color: CHECK_CONCLUSION_COLOR[status] ?? 0x6A_73_7D,
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
}
