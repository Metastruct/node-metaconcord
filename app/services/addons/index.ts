import { Container, Service } from "@/app/Container.js";
import {
	Addon,
	AddonGame,
	AddonSource,
	MountedGame,
	ReportedMod,
	RuntimeComponent,
	ServerAddons,
} from "./types.js";
import {
	GithubClient,
	GitResolution,
	ResolvedMeta,
	parseGitRemote,
	resolveByName,
	resolveCurseforge,
	resolveGit,
	resolveModrinth,
	resolveReadme,
	SUMMARY_LIMIT,
	workshopUrl,
} from "./resolvers.js";
import { TTLCache } from "./cache.js";
import GmodConnection from "../gamebridge/games/gmod/GmodConnection.js";
import MinecraftConnection from "../gamebridge/games/minecraft/MinecraftConnection.js";
import { logger } from "@/utils.js";

export * from "./types.js";

const log = logger(import.meta);
const DAY = 24 * 60 * 60 * 1000;
const GMOD_REFRESH_DEBOUNCE = 5 * 60 * 1000;
const TRANSIENT_RETRY_DELAY = 15 * 60 * 1000;
const TRANSIENT_MAX_RETRIES = 4;
const RESOLVE_CONCURRENCY = 6;
/**
 * Bumped whenever a refresh would produce fields the stored entries cannot have.
 * A server reconnecting with an older shape is pulled again instead of serving
 * data the current code would have built differently.
 */
export const ADDONS_SHAPE = 2;
/** Mod ids the loaders give themselves; the version of whichever one is present is the loader version. */
const LOADER_MODS = new Set(["neoforge", "forge", "fabricloader", "quilt_loader"]);
/** Never add-ons: the loader, the game it loads, and this bridge. */
const BUILTIN_MODS = new Set([...LOADER_MODS, "minecraft", "metaconcord"]);

/**
 * Walks ~/gserv/repos and prints one TSV line per addon root:
 * repo \t subpath ("." for the repo root) \t remote url \t workshop id \t branch
 *
 * A repo is a single addon when its root holds lua/, gamemodes/ or addon.json,
 * otherwise each first-level directory holding one of those is an addon.
 */
const GSERV_ENUMERATE_SCRIPT = [
	"cd ~/gserv/repos || exit 1",
	"for r in */; do",
	'  r=${r%/}; [ -d "$r" ] || continue',
	'  url=$(git -C "$r" remote get-url origin 2>/dev/null)',
	'  br=$(git -C "$r" rev-parse --abbrev-ref HEAD 2>/dev/null)',
	'  ws=$(head -n1 "$r/.workshopid" 2>/dev/null)',
	'  if [ -d "$r/lua" ] || [ -d "$r/gamemodes" ] || [ -f "$r/addon.json" ]; then subs="."; else',
	'    subs=$(cd "$r" && for d in */; do d=${d%/}; if [ -d "$d/lua" ] || [ -d "$d/gamemodes" ] || [ -f "$d/addon.json" ]; then printf \'%s\\n\' "$d"; fi; done)',
	"  fi",
	'  [ -z "$subs" ] && subs="."',
	"  for s in $subs; do",
	'    sws=$(head -n1 "$r/$s/.workshopid" 2>/dev/null)',
	'    printf \'%s\\t%s\\t%s\\t%s\\t%s\\n\' "$r" "$s" "$url" "${sws:-$ws}" "$br"',
	"  done",
	"done",
].join("\n");

async function mapLimit<T, R>(
	items: T[],
	limit: number,
	fn: (item: T) => Promise<R>
): Promise<R[]> {
	const results: R[] = new Array(items.length);
	let next = 0;
	const worker = async () => {
		while (next < items.length) {
			const i = next++;
			results[i] = await fn(items[i]);
		}
	};
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
	return results;
}

export class Addons extends Service {
	name = "Addons";
	private lastGmodRefresh = new Map<number, number>();
	private gmodGames = new Map<number, MountedGame[]>();
	private retryTimers = new Map<number, NodeJS.Timeout>();
	private workshopCache = new TTLCache<ResolvedMeta | null>(DAY);

	async init(): Promise<void> {
		const data = this.container.getService("Data");
		if (!data.addons) data.addons = {};
	}

	private githubClient(): GithubClient | undefined {
		const github = this.container.getService("Github");
		return github?.octokit as unknown as GithubClient | undefined;
	}

	getAll(): ServerAddons[] {
		const store = this.container.getService("Data").addons ?? {};
		const out: ServerAddons[] = [];
		for (const game of Object.keys(store) as AddonGame[]) {
			for (const entry of Object.values(store[game] ?? {})) out.push(entry);
		}
		return out.sort((a, b) => a.game.localeCompare(b.game) || a.serverId - b.serverId);
	}

	get(game: AddonGame, serverId: number): ServerAddons | undefined {
		return this.container.getService("Data").addons?.[game]?.[serverId];
	}

	/** Nothing stored for this server, or an entry built by an older shape. */
	needsRefresh(game: AddonGame, serverId: number): boolean {
		return this.get(game, serverId)?.shape !== ADDONS_SHAPE;
	}

	/**
	 * The games a gmod server reports on connect. It can arrive either side of the
	 * addon list being built, so it is kept here as well as on the entry: whichever
	 * lands second picks the other up.
	 */
	async setGmodGames(serverId: number, games: MountedGame[]): Promise<void> {
		this.gmodGames.set(serverId, games);
		const entry = this.get("gmod", serverId);
		if (!entry || JSON.stringify(entry.games) === JSON.stringify(games)) return;
		entry.games = games;
		await this.container.getService("Data").save();
	}

	/**
	 * Serve-time view of a stored entry: `restricted` is merged into the source for
	 * Metastruct team members and dropped for everyone else. Anything served publicly
	 * has to go through this.
	 */
	static forViewer(entry: ServerAddons, canSeeRestricted: boolean): ServerAddons {
		const { shape: _shape, ...rest } = entry;
		return {
			...rest,
			addons: entry.addons.map(({ restricted, ...addon }) => {
				if (!canSeeRestricted || !restricted) return addon;
				return {
					...addon,
					...(restricted.description ? { description: restricted.description } : {}),
					...(restricted.thumbnail ? { thumbnail: restricted.thumbnail } : {}),
					// A partial spread cannot be narrowed back onto the source union.
					source: restricted.source
						? ({ ...addon.source, ...restricted.source } as AddonSource)
						: addon.source,
				};
			}),
		};
	}

	private async store(entry: ServerAddons): Promise<void> {
		const data = this.container.getService("Data");
		data.addons ??= {};
		data.addons[entry.game] ??= {};
		data.addons[entry.game]![entry.serverId] = { ...entry, shape: ADDONS_SHAPE };
		await data.save();
	}

	/**
	 * Pull the addon list of a gmod server over SSH. Triggered once per server boot;
	 * entries whose git host was unreachable get retried a few times since the next
	 * natural refresh is the next restart.
	 */
	async refreshGmodRepos(server: GmodConnection, attempt = 0): Promise<void> {
		const { id, name } = server.config;
		if (!server.config.ssh) return;

		const last = this.lastGmodRefresh.get(id) ?? 0;
		if (attempt === 0 && Date.now() - last < GMOD_REFRESH_DEBOUNCE) return;
		this.lastGmodRefresh.set(id, Date.now());
		clearTimeout(this.retryTimers.get(id));
		this.retryTimers.delete(id);

		const result = await server.sshExecCommand(GSERV_ENUMERATE_SCRIPT, {});
		if (!result) return;
		if (result.code !== 0 && !result.stdout.trim()) {
			log.warn({ server: name, stderr: result.stderr }, "gserv enumeration failed");
			return;
		}

		const rows = result.stdout
			.split("\n")
			.map(line => line.split("\t"))
			.filter(cols => cols.length >= 2 && cols[0]);

		// A repo whose only addon root is one subfolder (content/, dist/...) is that addon.
		const rowsPerRepo = new Map<string, number>();
		for (const [repo] of rows) rowsPerRepo.set(repo, (rowsPerRepo.get(repo) ?? 0) + 1);

		// Keep the last known entry when a git host is down instead of flipping it to private.
		const previous = new Map<string, Addon>();
		for (const addon of this.get("gmod", id)?.addons ?? []) {
			if (addon.key) previous.set(addon.key, addon);
		}

		const built = await mapLimit(
			rows,
			RESOLVE_CONCURRENCY,
			([repo, sub, remote, wsid, branch]) =>
				this.buildGmodAddon(
					repo,
					rowsPerRepo.get(repo) === 1 ? "." : sub,
					remote,
					wsid,
					branch,
					previous
				)
		);
		const addons = built.map(b => b.addon);
		const transient = built.filter(b => b.transient).length;

		await this.store({
			game: "gmod",
			serverId: id,
			serverName: name,
			updatedAt: Date.now(),
			// the game reports these separately, either side of this rebuild
			games: this.gmodGames.get(id) ?? this.get("gmod", id)?.games,
			addons: addons.sort((a, b) => a.name.localeCompare(b.name)),
		});
		log.info({ server: name, count: addons.length, transient }, "refreshed gmod addons");

		if (transient > 0 && attempt < TRANSIENT_MAX_RETRIES) {
			log.warn({ server: name, transient, attempt }, "retrying unresolved git entries later");
			this.retryTimers.set(
				id,
				setTimeout(() => {
					this.refreshGmodRepos(server, attempt + 1).catch(err =>
						log.error({ err, server: name }, "addon refresh retry failed")
					);
				}, TRANSIENT_RETRY_DELAY)
			);
		}
	}

	private async buildGmodAddon(
		repo: string,
		sub: string,
		remote?: string,
		wsid?: string,
		branch?: string,
		previous?: Map<string, Addon>
	): Promise<{ addon: Addon; transient: boolean }> {
		const fallbackName = sub && sub !== "." ? sub : repo;
		const subpath = sub && sub !== "." ? sub : undefined;
		const key = `${repo}/${sub || "."}`;
		const parsed = remote ? parseGitRemote(remote) : undefined;

		let git: GitResolution = { public: false };
		if (parsed) {
			git = await resolveGit(parsed, this.githubClient());
			const last = previous?.get(key);
			if (git.transient && last) return { addon: last, transient: true };
		}
		const addon = await this.describeGmodAddon(
			repo,
			fallbackName,
			subpath,
			parsed,
			git,
			wsid,
			branch
		);
		return { addon: { ...addon, key }, transient: !!git.transient };
	}

	/**
	 * The branch is only worth showing when it is not the one the host serves by
	 * default. `defaultBranch` is unknown for hosts without an API and for private
	 * repos, so fall back to the usual names there.
	 */
	private interestingBranch(branch: string | undefined, git: GitResolution): string | undefined {
		branch = branch?.trim();
		// git prints "HEAD" when the checkout is detached.
		if (!branch || branch === "HEAD") return;
		const fallback = branch === "master" || branch === "main";
		return (git.meta?.defaultBranch ? branch === git.meta.defaultBranch : fallback)
			? undefined
			: branch;
	}

	private async describeGmodAddon(
		repo: string,
		fallbackName: string,
		subpath: string | undefined,
		parsed: ReturnType<typeof parseGitRemote>,
		git: GitResolution,
		wsid?: string,
		rawBranch?: string
	): Promise<Addon> {
		const baseUrl = git.meta?.url ?? parsed?.webUrl;
		const branch = this.interestingBranch(rawBranch, git);
		const treeSegment = parsed?.host === "gitlab" ? "/-/tree/" : "/tree/";
		const ref = branch ?? "HEAD";
		const repoUrl = !baseUrl
			? undefined
			: subpath
				? `${baseUrl}${treeSegment}${ref}/${subpath}`
				: branch
					? `${baseUrl}${treeSegment}${branch}`
					: baseUrl;
		// Everything a private repo would reveal is held back for team members, so the
		// public fields below read from these two and never from `git.meta` directly.
		const publicRepoUrl = git.public ? repoUrl : undefined;
		const publicMeta = git.public ? git.meta : undefined;
		const description = await this.describeRepo(repo, parsed, subpath, branch, git);

		if (wsid && /^\d+$/.test(wsid.trim())) {
			wsid = wsid.trim();
			const ws = await this.resolveWorkshop(wsid);
			const restricted = git.public
				? undefined
				: {
						...(repoUrl ? { source: { repoUrl } } : {}),
						...(description ? { description } : {}),
						...(!ws?.thumbnail && git.meta?.thumbnail
							? { thumbnail: git.meta.thumbnail }
							: {}),
					};
			return {
				name: ws?.name ?? publicMeta?.name ?? fallbackName,
				// workshop entries often carry an empty description, which is not an answer
				description: ws?.description || (git.public ? description : undefined),
				thumbnail: ws?.thumbnail ?? publicMeta?.thumbnail,
				source: {
					kind: "workshop",
					id: wsid,
					url: workshopUrl(wsid),
					repoUrl: publicRepoUrl,
				},
				private: false,
				...(restricted && Object.keys(restricted).length ? { restricted } : {}),
			};
		}

		if (!parsed) {
			return { name: fallbackName, source: { kind: "unknown" }, private: true };
		}

		if (!git.public) {
			return {
				name: fallbackName,
				source: { kind: "git", host: parsed.host, subpath },
				private: true,
				restricted: {
					source: { url: repoUrl, ...(branch ? { branch } : {}) },
					...(description ? { description } : {}),
					...(git.meta?.thumbnail ? { thumbnail: git.meta.thumbnail } : {}),
				},
			};
		}

		return {
			// A sub-addon keeps its folder name; the repo title describes the whole collection.
			name: subpath ? fallbackName : (publicMeta?.name ?? fallbackName),
			description,
			thumbnail: publicMeta?.thumbnail,
			source: { kind: "git", host: parsed.host, url: publicRepoUrl, subpath, branch },
			private: false,
		};
	}

	/**
	 * What the addon does, in one paragraph. A whole repo is described by the platform
	 * or its README; a folder inside a shared repo is described by its own README, and
	 * failing that by the repo it came out of, since that is all anyone can say about
	 * it. Callers decide whether the result may be public.
	 */
	private async describeRepo(
		repo: string,
		parsed: ReturnType<typeof parseGitRemote>,
		subpath: string | undefined,
		branch: string | undefined,
		git: GitResolution
	): Promise<string | undefined> {
		const readme = (path?: string) =>
			parsed
				? resolveReadme(parsed, path, branch, git.meta?.readmePath, this.githubClient())
				: undefined;
		const repoDescription = git.meta?.description?.trim() || undefined;

		if (!subpath) return repoDescription ?? (await readme());

		const own = await readme(subpath);
		if (own) return own;

		const parentName = git.meta?.name ?? repo;
		const parent = repoDescription ?? (await readme());
		const mention = ` (sub-addon of ${parentName})`;
		if (!parent) return `Sub-addon of ${parentName}`;
		// The mention is the point, so the inherited half is what gives way to the limit.
		const room = SUMMARY_LIMIT - mention.length;
		const inherited =
			parent.length > room ? `${parent.slice(0, room - 3).trimEnd()}...` : parent;
		return `${inherited}${mention}`;
	}

	private async resolveWorkshop(id: string): Promise<ResolvedMeta | undefined> {
		const cached = this.workshopCache.get(id);
		if (cached !== undefined) return cached ?? undefined;

		const steam = this.container.getService("Steam");
		const details = (await steam.getPublishedFileDetails([id]))?.publishedfiledetails?.[0];
		if (!details || details.result !== 1) {
			this.workshopCache.set(id, null);
			return;
		}
		const meta: ResolvedMeta = {
			name: details.title,
			description: details.description?.trim() || undefined,
			thumbnail: details.preview_url || undefined,
			url: workshopUrl(id),
		};
		this.workshopCache.set(id, meta);
		return meta;
	}

	/** Store the mod list a minecraft server published. */
	async setModList(server: MinecraftConnection, mods: ReportedMod[]): Promise<void> {
		const { id, name } = server.config;
		// the loader and the game itself are mods to the loader, so read them off the
		// list before it is filtered down to the mods anyone installed on purpose
		const runtime: RuntimeComponent[] = [
			mods.find(m => m.modId === "minecraft"),
			mods.find(m => LOADER_MODS.has(m.modId)),
		]
			.filter((m): m is ReportedMod => !!m)
			.map(({ modId, displayName, version }) => ({ id: modId, name: displayName, version }));
		const relevant = mods.filter(m => !BUILTIN_MODS.has(m.modId));

		const byHash = await resolveModrinth(
			relevant.map(m => m.sha512).filter((h): h is string => !!h)
		);
		const unresolved = relevant.filter(m => !(m.sha512 && byHash.has(m.sha512)));
		const byFingerprint = await resolveCurseforge(
			unresolved.map(m => m.fingerprint).filter((f): f is number => typeof f === "number")
		);

		const addons: Addon[] = [];
		for (const mod of relevant) {
			const modrinth = mod.sha512 ? byHash.get(mod.sha512) : undefined;
			if (modrinth) {
				addons.push({
					name: modrinth.name,
					description: modrinth.description,
					thumbnail: modrinth.thumbnail,
					version: mod.version,
					source: { kind: "modrinth", projectId: modrinth.projectId, url: modrinth.url },
					private: false,
				});
				continue;
			}

			const curse =
				typeof mod.fingerprint === "number"
					? byFingerprint.get(mod.fingerprint)
					: undefined;
			if (curse) {
				addons.push({
					name: curse.name,
					description: curse.description,
					thumbnail: curse.thumbnail,
					version: mod.version,
					source: { kind: "curseforge", projectId: curse.projectId, url: curse.url },
					private: false,
				});
				continue;
			}

			const remote = mod.sources ? parseGitRemote(mod.sources) : undefined;
			if (remote && remote.host === "other" && /^https?:/.test(mod.sources ?? "")) {
				addons.push({
					name: mod.displayName,
					description: mod.description,
					version: mod.version,
					source: { kind: "website", url: mod.sources! },
					private: false,
				});
				continue;
			}
			const git = remote ? await resolveGit(remote, this.githubClient()) : undefined;
			if (remote && git?.public) {
				addons.push({
					name: git.meta?.name ?? mod.displayName,
					description: git.meta?.description ?? mod.description,
					thumbnail: git.meta?.thumbnail,
					version: mod.version,
					source: { kind: "git", host: remote.host, url: git.meta?.url ?? remote.webUrl },
					private: false,
				});
				continue;
			}

			// The jar is published somewhere, it just is not the file that platform
			// serves, so neither hash nor fingerprint matched. Try the mod id.
			const named = await resolveByName(mod.modId, mod.displayName);
			if (named) {
				addons.push({
					name: named.meta.name,
					description: named.meta.description,
					thumbnail: named.meta.thumbnail,
					version: mod.version,
					source:
						named.platform === "modrinth"
							? { kind: "modrinth", projectId: named.projectId, url: named.meta.url }
							: {
									kind: "curseforge",
									projectId: named.projectId,
									url: named.meta.url,
								},
					private: false,
				});
				continue;
			}

			if (remote) {
				addons.push({
					name: mod.displayName,
					description: mod.description,
					version: mod.version,
					source: { kind: "git", host: remote.host },
					private: true,
					restricted: { source: { url: remote.webUrl } },
				});
				continue;
			}

			addons.push({
				name: mod.displayName,
				description: mod.description,
				version: mod.version,
				source: { kind: "unknown" },
				private: true,
			});
		}

		await this.store({
			game: "minecraft",
			serverId: id,
			serverName: name,
			updatedAt: Date.now(),
			...(runtime.length ? { runtime } : {}),
			addons: addons.sort((a, b) => a.name.localeCompare(b.name)),
		});
		log.info({ server: name, count: addons.length }, "stored minecraft mods");
	}
}

export default (container: Container): Service => {
	return new Addons(container);
};
