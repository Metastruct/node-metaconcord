export type GitHost = "github" | "gitlab" | "other";

export type AddonSource =
	| { kind: "workshop"; id: string; url: string; repoUrl?: string }
	| { kind: "git"; url?: string; host: GitHost; subpath?: string; branch?: string }
	| { kind: "modrinth"; projectId: string; url: string }
	| { kind: "curseforge"; projectId: number; url: string }
	/** A plain homepage that is not a known git host or registry. */
	| { kind: "website"; url: string }
	| { kind: "unknown" };

export interface Addon {
	/** Platform title when resolved, otherwise the folder/repo name or mod display name. */
	name: string;
	description?: string;
	thumbnail?: string;
	/** Minecraft only. */
	version?: string;
	source: AddonSource;
	/**
	 * Private git remotes and unresolvable internal content. Private entries never
	 * carry a URL in public responses.
	 */
	private: boolean;
	/**
	 * What is known about a private repo: served to logged-in Metastruct team members,
	 * dropped for everyone else. Never fold any of it into the fields above.
	 */
	restricted?: {
		/** Merged into `source`. */
		source?: { url?: string; repoUrl?: string; branch?: string };
		/** Merged into the addon, from the repo description or its README. */
		description?: string;
		/** Merged into the addon: the repo or owner avatar. */
		thumbnail?: string;
	};
	/** Stable identity within a server (gmod: "repo/subpath"), used to carry entries over transient failures. */
	key?: string;
}

export type AddonGame = "gmod" | "minecraft";

/** One game whose content a server has mounted, as the engine reports it. */
export interface MountedGame {
	folder: string;
	title?: string;
}

export interface ServerAddons {
	game: AddonGame;
	serverId: number;
	serverName: string;
	/** Epoch ms of the last successful refresh. */
	updatedAt: number;
	/** Shape of the stored entry, see ADDONS_SHAPE. Absent on entries written before it existed. */
	shape?: number;
	/** gmod only, reported by the game rather than found over SSH. Absent until it reports. */
	games?: MountedGame[];
	addons: Addon[];
}

export type AddonsStore = {
	[game in AddonGame]?: { [serverId: number]: ServerAddons };
};

/** One mod as reported by the minecraft bridge. */
export interface ReportedMod {
	modId: string;
	displayName: string;
	version: string;
	description?: string;
	sha512?: string;
	fingerprint?: number;
	sources?: string;
	issues?: string;
}
