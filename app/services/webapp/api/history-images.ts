import { Octokit } from "@octokit/rest";
import { createHash } from "node:crypto";
import HistoryConfig from "@/config/history.json" with { type: "json" };
import axios from "axios";

/**
 * Copies history images into the history repo so the timeline stops depending on
 * third party hosts, which rot: one of the original links was already a 404.
 *
 * Files are named by their content hash, not by event id, because an id is derived
 * from the event's date and name and therefore changes when an event is renamed,
 * which would strand or collide files. Hashing also dedupes an image shared by two
 * events and makes re-running the mirror a no-op.
 *
 * The returned URL pins the commit that holds the image. jsDelivr caches its
 * branch-to-commit lookup for up to 12 hours, so a `@master` URL would 404 for the
 * rest of the editing session; a 40 hex ref resolves immediately and is immutable.
 *
 * Serving this way needs the repo to stay public. If it is ever made private every
 * timeline image breaks at once, and the fix is to change cdnBase and rewrite the
 * URLs, which is cheap because the bytes are already ours.
 *
 * Deliberately not using the git trees API: it would buy one atomic commit for
 * 4-5 calls instead of 2, and would replace the per blob concurrency that the 409
 * handling in history.ts and the website's single retry are built around. The only
 * thing it prevents is an orphan blob when the history.json write fails afterwards,
 * which costs nothing and is reused by the next attempt.
 */

const IMAGE_DIR = HistoryConfig.imageDir || "images";
const CDN_BASE = HistoryConfig.cdnBase || "https://cdn.jsdelivr.net";
const MAX_BYTES = HistoryConfig.maxImageBytes || 8 * 1024 * 1024;

const CDN_PREFIX = `${CDN_BASE}/gh/${HistoryConfig.owner}/${HistoryConfig.repo}@`;

/** A source we cannot use. The message is shown to the editor, so keep it readable. */
export class MirrorError extends Error {}

const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

/**
 * The extension has to come from the bytes: several imgur URLs ending in .jpg
 * actually serve PNG, and Steam's UGC URLs carry no extension at all.
 */
const SIGNATURES: { ext: string; test: (b: Buffer) => boolean }[] = [
	{ ext: "png", test: b => b.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")) },
	{ ext: "jpg", test: b => b.subarray(0, 3).equals(Buffer.from("ffd8ff", "hex")) },
	{ ext: "gif", test: b => b.subarray(0, 4).toString("latin1") === "GIF8" },
	{
		ext: "webp",
		test: b =>
			b.subarray(0, 4).toString("latin1") === "RIFF" &&
			b.subarray(8, 12).toString("latin1") === "WEBP",
	},
];

const sniff = (buf: Buffer): string | undefined =>
	buf.length > 12 ? SIGNATURES.find(s => s.test(buf))?.ext : undefined;

/** True when the URL already points at our own mirrored copy. */
export const isMirrored = (url: string): boolean => url.startsWith(CDN_PREFIX);

/**
 * Blocks the obvious internal targets. A complete fix would need a custom agent
 * lookup hook to survive DNS rebinding, which is not worth it here: the caller is
 * an authenticated team member and the result is published publicly anyway.
 */
const assertPublicHost = (raw: string): void => {
	let parsed: URL;
	try {
		parsed = new URL(raw);
	} catch {
		throw new MirrorError("that is not a valid URL");
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
		throw new MirrorError("the image URL must be http or https");
	const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
	if (
		host === "localhost" ||
		host.endsWith(".localhost") ||
		host.endsWith(".internal") ||
		host === "::1" ||
		/^127\./.test(host) ||
		/^10\./.test(host) ||
		/^192\.168\./.test(host) ||
		/^169\.254\./.test(host) ||
		/^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
		/^f[cd][0-9a-f]{2}:/i.test(host)
	)
		throw new MirrorError("that host is not reachable from the internet");
};

const download = async (
	url: string,
	timeoutMs: number
): Promise<{ bytes: Buffer; ext: string }> => {
	let res;
	try {
		res = await axios.get<ArrayBuffer>(url, {
			responseType: "arraybuffer",
			maxContentLength: MAX_BYTES,
			maxBodyLength: MAX_BYTES,
			maxRedirects: 3,
			timeout: timeoutMs,
			validateStatus: s => s === 200,
			headers: {
				accept: "image/avif,image/webp,image/png,image/jpeg,image/gif;q=0.9,*/*;q=0.5",
				"user-agent": "metaconcord history mirror (+https://metastruct.net)",
			},
		});
	} catch (err) {
		const e = err as { response?: { status?: number }; code?: string };
		if (e.response?.status) throw new MirrorError(`source returned ${e.response.status}`);
		if (e.code === "ERR_FR_MAX_CONTENT_LENGTH_EXCEEDED")
			throw new MirrorError(`image is larger than ${Math.round(MAX_BYTES / 1024 / 1024)} MB`);
		throw new MirrorError(`source unreachable (${e.code || "unknown error"})`);
	}

	const type = String(res.headers["content-type"] || "")
		.split(";")[0]
		.trim()
		.toLowerCase();
	if (!ALLOWED_TYPES.includes(type))
		throw new MirrorError(`unsupported content type ${type || "none"}`);

	const bytes = Buffer.from(res.data);
	if (!bytes.length) throw new MirrorError("source returned an empty body");
	if (bytes.length > MAX_BYTES)
		throw new MirrorError(`image is larger than ${Math.round(MAX_BYTES / 1024 / 1024)} MB`);

	// a 200 can still lie about its type, so trust the bytes over the header
	const ext = sniff(bytes);
	if (!ext) throw new MirrorError("the URL did not return an image");
	return { bytes, ext };
};

/** Last resort for a source that has gone away. Returns undefined when nothing is archived. */
const fromWayback = async (
	url: string
): Promise<{ bytes: Buffer; ext: string; via: string } | undefined> => {
	try {
		const { data } = await axios.get(
			`https://archive.org/wayback/available?url=${encodeURIComponent(url)}`,
			{ timeout: 30_000 }
		);
		const closest = data?.archived_snapshots?.closest;
		if (!closest?.available || String(closest.status) !== "200") return undefined;
		// id_ serves the original bytes instead of the archive's HTML viewer
		const via = `https://web.archive.org/web/${closest.timestamp}id_/${url}`;
		return { ...(await download(via, 60_000)), via };
	} catch {
		return undefined;
	}
};

/** Filenames already committed under the image directory. */
const listImages = async (octokit: Octokit): Promise<Set<string>> => {
	try {
		// the directory listing, never the file: getContent refuses blobs over 1 MB
		const { data } = await octokit.repos.getContent({
			owner: HistoryConfig.owner,
			repo: HistoryConfig.repo,
			path: IMAGE_DIR,
			ref: HistoryConfig.branch,
		});
		// TODO: switch to git.getTree({ recursive }) if this ever passes 1000 entries
		return new Set(Array.isArray(data) ? data.map(entry => entry.name) : []);
	} catch (err) {
		if ((err as { status?: number }).status === 404) return new Set();
		throw err;
	}
};

/** Any commit touching the path is a valid pin, because the content never changes. */
const pinFor = async (octokit: Octokit, path: string): Promise<string> => {
	const { data } = await octokit.repos.listCommits({
		owner: HistoryConfig.owner,
		repo: HistoryConfig.repo,
		sha: HistoryConfig.branch,
		path,
		per_page: 1,
	});
	if (!data.length) throw new Error(`no commit found for ${path}`);
	return data[0].sha;
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Copies the image into the history repo and returns the URL to store on the event.
 * Returns the URL untouched when there is nothing to do.
 *
 * Throws MirrorError when the source cannot be used, and the underlying octokit
 * error when GitHub refuses the write.
 */
export const mirrorImage = async (
	octokit: Octokit,
	sourceUrl: string,
	context: string
): Promise<string> => {
	// already ours, a site asset, or not a remote URL at all
	if (!sourceUrl || isMirrored(sourceUrl) || !/^https?:\/\//.test(sourceUrl)) return sourceUrl;
	assertPublicHost(sourceUrl);

	let got: { bytes: Buffer; ext: string; via?: string };
	try {
		got = await download(sourceUrl, 15_000);
	} catch (err) {
		const archived = await fromWayback(sourceUrl);
		if (!archived) throw err;
		got = archived;
	}

	const file = `${createHash("sha256").update(got.bytes).digest("hex").slice(0, 12)}.${got.ext}`;
	const path = `${IMAGE_DIR}/${file}`;

	if ((await listImages(octokit)).has(file))
		return `${CDN_PREFIX}${await pinFor(octokit, path)}/${path}`;

	const message =
		`Add image for ${context}\n\nMirrored from ${sourceUrl}` +
		(got.via ? `\nvia ${got.via}` : "");

	const commit = async () => {
		const { data } = await octokit.repos.createOrUpdateFileContents({
			owner: HistoryConfig.owner,
			repo: HistoryConfig.repo,
			path,
			branch: HistoryConfig.branch,
			message,
			content: got.bytes.toString("base64"),
		});
		return data.commit.sha;
	};

	let sha: string | undefined;
	try {
		sha = await commit();
	} catch (err) {
		const status = (err as { status?: number }).status;
		// 422 means someone committed the same bytes first, 409 means the branch moved
		if (status === 409) {
			await sleep(750);
			try {
				sha = await commit();
			} catch (retryErr) {
				if ((retryErr as { status?: number }).status !== 422) throw retryErr;
			}
		} else if (status !== 422) {
			throw err;
		}
	}

	return `${CDN_PREFIX}${sha || (await pinFor(octokit, path))}/${path}`;
};
