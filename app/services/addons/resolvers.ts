import { TTLCache } from "./cache.js";
import type { GitHost } from "./types.js";
import { logger } from "@/utils.js";
import apikeys from "@/config/apikeys.json" with { type: "json" };
import axios from "axios";

const log = logger(import.meta);
const DAY = 24 * 60 * 60 * 1000;
const USER_AGENT = "metastruct/node-metaconcord (https://github.com/Metastruct/node-metaconcord)";

// Axios errors serialize their whole request config, auth headers included.
const errInfo = (err: unknown) =>
	axios.isAxiosError(err)
		? { message: err.message, status: err.response?.status, data: err.response?.data }
		: err;

export interface ResolvedMeta {
	name: string;
	description?: string;
	thumbnail?: string;
	url: string;
	/** Only known for hosts with an API; used to tell an interesting branch from the usual one. */
	defaultBranch?: string;
}

export interface GitRemote {
	host: GitHost;
	hostname: string;
	/** "owner/repo" or "group/sub/repo" without ".git". */
	path: string;
	webUrl: string;
}

/** Turns any clone URL into a web URL, stripping credentials and ".git". */
export function parseGitRemote(remote: string): GitRemote | undefined {
	remote = remote.trim();
	if (!remote) return;

	let hostname: string | undefined;
	let path: string | undefined;

	const scp = /^(?:[^@\s]+@)?([^:/\s]+):(?!\/\/)(.+)$/.exec(remote);
	if (scp) {
		hostname = scp[1];
		path = scp[2];
	} else {
		try {
			const url = new URL(remote);
			hostname = url.hostname;
			path = url.pathname;
		} catch {
			return;
		}
	}

	path = path
		.replace(/^\/+/, "")
		.replace(/\/+$/, "")
		.replace(/\.git$/, "");
	if (!path || !hostname) return;

	const host: GitHost = hostname.endsWith("github.com")
		? "github"
		: hostname.includes("gitlab")
			? "gitlab"
			: "other";

	return { host, hostname, path, webUrl: `https://${hostname}/${path}` };
}

/** `transient` marks a 5xx/network failure: nothing is known, the result is not cached. */
export type GitResolution = { public: boolean; meta?: ResolvedMeta; transient?: boolean };
const gitCache = new TTLCache<GitResolution>(DAY);
const inflight = new Map<string, Promise<GitResolution>>();

type GithubRepo = {
	name: string;
	description: string | null;
	html_url: string;
	private: boolean;
	default_branch: string;
	owner: { avatar_url: string };
};

/** Minimal shape of the Octokit client we rely on, so callers can pass a stub. */
export interface GithubClient {
	rest: {
		repos: {
			get(params: {
				owner: string;
				repo: string;
			}): Promise<{ status: number; data: GithubRepo }>;
		};
	};
	graphql(query: string, vars: Record<string, string>): Promise<unknown>;
}

/**
 * Public/private classification and metadata in one call. Concurrent lookups of
 * the same URL share one request. GitHub goes through the authenticated client
 * when available (rate limit) and trusts its `private` flag; everything else is
 * unauthenticated, so a non-200 means private.
 */
export async function resolveGit(remote: GitRemote, github?: GithubClient): Promise<GitResolution> {
	const cached = gitCache.get(remote.webUrl);
	if (cached) return cached;

	const pending = inflight.get(remote.webUrl);
	if (pending) return pending;

	const promise = resolveGitUncached(remote, github).finally(() =>
		inflight.delete(remote.webUrl)
	);
	inflight.set(remote.webUrl, promise);
	return promise;
}

async function resolveGitUncached(
	remote: GitRemote,
	github?: GithubClient
): Promise<GitResolution> {
	let result: GitResolution;
	try {
		if (remote.host === "github") {
			result = await resolveGithub(remote, github);
		} else if (remote.host === "gitlab") {
			result = await resolveGitlab(remote);
		} else {
			const res = await axios.head(remote.webUrl, {
				maxRedirects: 0,
				validateStatus: () => true,
				timeout: 10000,
				headers: { "User-Agent": USER_AGENT },
			});
			result = {
				public: res.status === 200,
				meta:
					res.status === 200
						? { name: remote.path.split("/").pop() ?? remote.path, url: remote.webUrl }
						: undefined,
				transient: res.status >= 500,
			};
		}
	} catch (err) {
		log.warn({ err: errInfo(err), remote: remote.webUrl }, "git resolution failed");
		result = { public: false, transient: true };
	}
	if (result.transient) {
		log.warn({ remote: remote.webUrl }, "git host unavailable, result not cached");
		return result;
	}
	return gitCache.set(remote.webUrl, result);
}

async function fetchGithubRepo(
	owner: string,
	repo: string,
	github?: GithubClient
): Promise<{ status: number; data?: GithubRepo }> {
	if (github) {
		try {
			const res = await github.rest.repos.get({ owner, repo });
			return { status: res.status, data: res.data };
		} catch (err) {
			const status = (err as { status?: number }).status ?? 0;
			// 404 is a definitive answer; auth problems fall through to the anonymous path
			if (status === 404 || status >= 500) return { status };
			log.warn(
				{ err: errInfo(err), owner, repo },
				"authenticated github lookup failed, retrying anonymously"
			);
		}
	}

	const res = await axios.get<GithubRepo>(`https://api.github.com/repos/${owner}/${repo}`, {
		validateStatus: () => true,
		timeout: 10000,
		headers: { "User-Agent": USER_AGENT, Accept: "application/vnd.github+json" },
	});
	if (res.status === 403 && res.headers["x-ratelimit-remaining"] === "0") {
		log.warn({ owner, repo }, "anonymous github rate limit hit");
		return { status: 503 };
	}
	return { status: res.status, data: res.status === 200 ? res.data : undefined };
}

async function resolveGithub(remote: GitRemote, github?: GithubClient): Promise<GitResolution> {
	const [owner, repo] = remote.path.split("/");
	if (!owner || !repo) return { public: false };

	const res = await fetchGithubRepo(owner, repo, github);
	if (res.status !== 200 || !res.data) return { public: false, transient: res.status >= 500 };
	if (res.data.private) return { public: false };

	const meta: ResolvedMeta = {
		name: res.data.name,
		description: res.data.description ?? undefined,
		thumbnail: res.data.owner.avatar_url,
		url: res.data.html_url,
		defaultBranch: res.data.default_branch,
	};

	// Only repos with a custom social preview get the OpenGraph image; the
	// auto-generated card is a worse thumbnail than the owner avatar.
	if (github) {
		try {
			const data = (await github.graphql(
				`
					query ($owner: String!, $repo: String!) {
						repository(owner: $owner, name: $repo) {
							openGraphImageUrl
						}
					}
				`,
				{ owner, repo }
			)) as { repository?: { openGraphImageUrl?: string } };
			const og = data.repository?.openGraphImageUrl;
			if (og && og.includes("repository-images.githubusercontent.com")) {
				meta.thumbnail = og;
			}
		} catch {
			// optional enrichment
		}
	}

	return { public: true, meta };
}

async function resolveGitlab(remote: GitRemote): Promise<GitResolution> {
	const res = await axios.get<{
		id: number;
		name: string;
		description: string | null;
		web_url: string;
		default_branch: string | null;
		avatar_url: string | null;
		namespace?: { avatar_url: string | null };
	}>(`https://${remote.hostname}/api/v4/projects/${encodeURIComponent(remote.path)}`, {
		validateStatus: () => true,
		timeout: 10000,
		headers: { "User-Agent": USER_AGENT },
	});
	if (res.status !== 200) return { public: false, transient: res.status >= 500 };

	// A project can be public while its repository is members-only; what matters
	// is whether the code is readable, so probe the tree as well.
	const tree = await axios.get(
		`https://${remote.hostname}/api/v4/projects/${res.data.id}/repository/tree`,
		{
			params: { per_page: 1 },
			validateStatus: () => true,
			timeout: 10000,
			headers: { "User-Agent": USER_AGENT },
		}
	);
	if (tree.status !== 200) return { public: false, transient: tree.status >= 500 };

	const avatar = res.data.avatar_url ?? res.data.namespace?.avatar_url ?? undefined;
	return {
		public: true,
		meta: {
			name: res.data.name,
			description: res.data.description ?? undefined,
			thumbnail:
				avatar && avatar.startsWith("/") ? `https://${remote.hostname}${avatar}` : avatar,
			url: res.data.web_url,
			defaultBranch: res.data.default_branch ?? undefined,
		},
	};
}

export const workshopUrl = (id: string) =>
	`https://steamcommunity.com/sharedfiles/filedetails/?id=${id}`;

type ModrinthVersion = { project_id: string };
type ModrinthProject = {
	id: string;
	slug: string;
	title: string;
	description: string;
	icon_url: string | null;
};
export type ModrinthMatch = ResolvedMeta & { projectId: string };

const modrinthCache = new TTLCache<ModrinthMatch | null>(DAY);

/** sha512 -> project, for every hash Modrinth knows. Unknown hashes are absent. */
export async function resolveModrinth(hashes: string[]): Promise<Map<string, ModrinthMatch>> {
	const out = new Map<string, ModrinthMatch>();
	const missing: string[] = [];
	for (const hash of hashes) {
		const cached = modrinthCache.get(hash);
		if (cached === undefined) missing.push(hash);
		else if (cached) out.set(hash, cached);
	}
	if (!missing.length) return out;

	try {
		const versions = (
			await axios.post<Record<string, ModrinthVersion>>(
				"https://api.modrinth.com/v2/version_files",
				{ hashes: missing, algorithm: "sha512" },
				{ headers: { "User-Agent": USER_AGENT }, timeout: 15000 }
			)
		).data;

		const projectIds = [...new Set(Object.values(versions).map(v => v.project_id))];
		const projects = projectIds.length
			? (
					await axios.get<ModrinthProject[]>("https://api.modrinth.com/v2/projects", {
						params: { ids: JSON.stringify(projectIds) },
						headers: { "User-Agent": USER_AGENT },
						timeout: 15000,
					})
				).data
			: [];
		const byId = new Map(projects.map(p => [p.id, p]));

		for (const hash of missing) {
			const project = versions[hash] ? byId.get(versions[hash].project_id) : undefined;
			if (!project) {
				modrinthCache.set(hash, null);
				continue;
			}
			const match: ModrinthMatch = {
				projectId: project.id,
				name: project.title,
				description: project.description,
				thumbnail: project.icon_url ?? undefined,
				url: `https://modrinth.com/mod/${project.slug}`,
			};
			modrinthCache.set(hash, match);
			out.set(hash, match);
		}
	} catch (err) {
		log.warn({ err: errInfo(err) }, "modrinth resolution failed");
	}
	return out;
}

export type CurseforgeMatch = ResolvedMeta & { projectId: number };
const curseforgeCache = new TTLCache<CurseforgeMatch | null>(DAY);
const curseforgeKey = (apikeys as { curseforge?: string }).curseforge;

export const curseforgeEnabled = () => !!curseforgeKey;

/** murmur2 fingerprint -> mod. No-op without an API key. */
export async function resolveCurseforge(
	fingerprints: number[]
): Promise<Map<number, CurseforgeMatch>> {
	const out = new Map<number, CurseforgeMatch>();
	if (!curseforgeKey) return out;

	const missing: number[] = [];
	for (const fp of fingerprints) {
		const cached = curseforgeCache.get(String(fp));
		if (cached === undefined) missing.push(fp);
		else if (cached) out.set(fp, cached);
	}
	if (!missing.length) return out;

	const headers = { "x-api-key": curseforgeKey, "User-Agent": USER_AGENT };
	try {
		const matches = (
			await axios.post<{
				data: {
					exactMatches: {
						/** the mod id, not the fingerprint */
						id: number;
						file: { modId: string | number; fileFingerprint: number };
					}[];
				};
			}>(
				"https://api.curseforge.com/v1/fingerprints",
				{ fingerprints: missing },
				{ headers, timeout: 15000 }
			)
		).data.data.exactMatches;

		const fpToMod = new Map<number, number>();
		for (const m of matches) fpToMod.set(Number(m.file.fileFingerprint), Number(m.file.modId));

		const modIds = [...new Set(fpToMod.values())];
		const mods = modIds.length
			? (
					await axios.post<{
						data: {
							id: number;
							name: string;
							summary: string;
							logo: { thumbnailUrl: string } | null;
							links: { websiteUrl: string };
						}[];
					}>(
						"https://api.curseforge.com/v1/mods",
						{ modIds },
						{ headers, timeout: 15000 }
					)
				).data.data
			: [];
		const byId = new Map(mods.map(m => [m.id, m]));

		for (const fp of missing) {
			const modId = fpToMod.get(fp);
			const mod = modId !== undefined ? byId.get(modId) : undefined;
			if (!mod) {
				curseforgeCache.set(String(fp), null);
				continue;
			}
			const match: CurseforgeMatch = {
				projectId: mod.id,
				name: mod.name,
				description: mod.summary,
				thumbnail: mod.logo?.thumbnailUrl,
				url: mod.links.websiteUrl,
			};
			curseforgeCache.set(String(fp), match);
			out.set(fp, match);
		}
	} catch (err) {
		log.warn({ err: errInfo(err) }, "curseforge resolution failed");
	}
	return out;
}

type CurseforgeMod = {
	id: number;
	name: string;
	slug: string;
	summary: string;
	logo: { thumbnailUrl: string } | null;
	links: { websiteUrl: string };
};

export type PlatformMatch =
	| { platform: "modrinth"; projectId: string; meta: ResolvedMeta }
	| { platform: "curseforge"; projectId: number; meta: ResolvedMeta };

const nameCache = new TTLCache<PlatformMatch | null>(DAY);
const compact = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

const slugCandidates = (modId: string, displayName: string): string[] => {
	const out = new Set<string>();
	for (const raw of [modId, displayName]) {
		const base = (raw ?? "")
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-|-$/g, "");
		if (!base) continue;
		out.add(base);
		out.add(base.replace(/-/g, ""));
	}
	return [...out];
};

/**
 * Last resort for a jar that neither a hash nor a fingerprint matched, which
 * happens when the installed file is not the one the platform publishes.
 * Exact slug lookups only, and the project has to carry the name the jar
 * reported: slugs get reused by unrelated mods ("ponder" on modrinth is Ponder
 * for KubeJS, not Create's Ponder), so an unverified hit is worse than none.
 * Nothing matches for a mod that only exists nested inside another jar.
 */
export async function resolveByName(
	modId: string,
	displayName: string
): Promise<PlatformMatch | undefined> {
	const cacheKey = `${modId} ${displayName}`;
	const cached = nameCache.get(cacheKey);
	if (cached !== undefined) return cached ?? undefined;

	const wanted = new Set([compact(modId ?? ""), compact(displayName ?? "")]);
	wanted.delete("");
	const candidates = slugCandidates(modId, displayName);
	if (!wanted.size || !candidates.length) return;

	for (const slug of candidates) {
		try {
			const res = await axios.get<ModrinthProject>(
				`https://api.modrinth.com/v2/project/${encodeURIComponent(slug)}`,
				{
					validateStatus: () => true,
					timeout: 10000,
					headers: { "User-Agent": USER_AGENT },
				}
			);
			if (res.status !== 200) continue;
			// only the title proves anything, the slug is what we searched by
			if (!wanted.has(compact(res.data.title))) continue;
			return nameCache.set(cacheKey, {
				platform: "modrinth",
				projectId: res.data.id,
				meta: {
					name: res.data.title,
					description: res.data.description,
					thumbnail: res.data.icon_url ?? undefined,
					url: `https://modrinth.com/mod/${res.data.slug}`,
				},
			}) as PlatformMatch;
		} catch (err) {
			log.warn({ err: errInfo(err), slug }, "modrinth slug lookup failed");
		}
	}

	if (curseforgeKey) {
		for (const slug of candidates) {
			try {
				const res = await axios.get<{ data: CurseforgeMod[] }>(
					"https://api.curseforge.com/v1/mods/search",
					{
						// slugs are only unique within a class, so pin it to mods
						params: { gameId: 432, classId: 6, slug, pageSize: 5 },
						headers: { "x-api-key": curseforgeKey, "User-Agent": USER_AGENT },
						validateStatus: () => true,
						timeout: 10000,
					}
				);
				if (res.status !== 200) continue;
				const mod = (res.data.data ?? []).find(m => wanted.has(compact(m.name)));
				if (!mod) continue;
				return nameCache.set(cacheKey, {
					platform: "curseforge",
					projectId: mod.id,
					meta: {
						name: mod.name,
						description: mod.summary,
						thumbnail: mod.logo?.thumbnailUrl,
						url: mod.links.websiteUrl,
					},
				}) as PlatformMatch;
			} catch (err) {
				log.warn({ err: errInfo(err), slug }, "curseforge slug lookup failed");
			}
		}
	}

	nameCache.set(cacheKey, null);
	return;
}
