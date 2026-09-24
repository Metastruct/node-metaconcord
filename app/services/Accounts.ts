import { Container, Service } from "../Container.js";
import { SQL } from "./SQL.js";
import { decrypt, encrypt } from "./webapp/secretBox.js";
import { Octokit } from "@octokit/rest";
import AccountsConfig from "@/config/accounts.json" with { type: "json" };
import GithubConfig from "@/config/github.json" with { type: "json" };
import crypto from "crypto";
import { isSteamGroupMember, logger } from "@/utils.js";

const log = logger(import.meta);

/**
 * One account per person, any number of linked platforms. Providers with a web login
 * (discord, steam, github, gitlab) can create an account or log into it; steam and
 * minecraft can also be linked from in game with a short code typed in chat.
 *
 * Roles are derived, never edited: GitHub team membership through github.json's role
 * map, plus the Steam groups in accounts.json. Only links proven by
 * OAuth, OpenID or an in-game code count, imported ones are display only.
 */

export type Provider = "discord" | "steam" | "github" | "gitlab" | "minecraft";
export type LinkSource = "oauth" | "openid" | "ingame" | "import";
export type Role = "administrator" | "developer" | "trial-developer";

/** Providers that can log someone in, so an account must keep at least one. */
export const LOGIN_PROVIDERS: Provider[] = ["discord", "steam", "github", "gitlab"];
/** Providers linked from game chat with a code. */
export const CODE_PROVIDERS: Provider[] = ["steam", "minecraft"];
export const ROLES: Role[] = ["administrator", "developer", "trial-developer"];
/** What the website calls staff: everything but the onboarding team. */
export const STAFF_ROLES: Role[] = ["administrator", "developer"];

const TEAM_ROLES = GithubConfig.roles as Record<string, Role>;
/** Steam group id64 to role, only for proven Steam links. */
const STEAM_GROUP_ROLES = AccountsConfig.steamGroups as Record<string, Role>;

const ROLES_TTL = 60 * 60 * 1000;
const ROLES_RETRY = 5 * 60 * 1000;
/** the background sweep: every account, from one team listing per team and fresh Steam groups */
const SWEEP_INTERVAL = 60 * 60 * 1000;
const CODE_TTL = 10 * 60 * 1000;
const CODE_LENGTH = 8;
// no 0/O/1/I, the code is read off a screen and typed in a game chat
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const SESSION_CACHE_TTL = 10 * 1000;

export type GithubToken = {
	accessToken: string;
	refreshToken?: string;
	/** ms epoch, only set when the GitHub App expires user tokens */
	expiresAt?: number;
};

export type Account = {
	id: number;
	displayName: string;
	avatar: string;
	roles: Role[];
	rolesCheckedAt: number;
	createdAt: number;
	/** baked into session cookies, bumped to log every browser out */
	sessionVersion: number;
};

export type AccountLink = {
	provider: Provider;
	providerId: string;
	name: string;
	avatar: string;
	source: LinkSource;
	/** encrypted GithubToken, github only */
	token?: string;
	email?: string;
	emailVerified?: boolean;
	linkedAt: number;
};

export type LinkInput = {
	provider: Provider;
	providerId: string;
	name: string;
	avatar?: string;
	source: LinkSource;
	token?: GithubToken;
	email?: string;
	emailVerified?: boolean;
};

export type AccountWithLinks = Account & { links: AccountLink[] };

export class LinkConflictError extends Error {
	constructor(public provider: Provider) {
		super(
			`this ${provider} account belongs to another account that has other ways to log in; log into that one and unlink it there`
		);
	}
}

export class LastLoginError extends Error {
	constructor() {
		super("cannot unlink the last platform that can log you in");
	}
}

type AccountRow = {
	id: string;
	display_name: string;
	avatar: string;
	roles: Role[];
	roles_checked_at: Date | null;
	created_at: Date;
	session_version: number;
};

type LinkRow = {
	account_id: string;
	provider: Provider;
	provider_id: string;
	name: string;
	avatar: string;
	source: LinkSource;
	token: string | null;
	email: string | null;
	email_verified: boolean;
	linked_at: Date;
};

const toAccount = (row: AccountRow): Account => ({
	id: Number(row.id),
	displayName: row.display_name,
	avatar: row.avatar,
	roles: Array.isArray(row.roles) ? row.roles : [],
	rolesCheckedAt: row.roles_checked_at?.getTime() ?? 0,
	createdAt: row.created_at.getTime(),
	sessionVersion: row.session_version,
});

const toLink = (row: LinkRow): AccountLink => ({
	provider: row.provider,
	providerId: row.provider_id,
	name: row.name,
	avatar: row.avatar,
	source: row.source,
	token: row.token ?? undefined,
	email: row.email ?? undefined,
	emailVerified: row.email_verified,
	linkedAt: row.linked_at.getTime(),
});

export class Accounts extends Service {
	name = "Accounts";
	private sql: SQL;
	private cache = new Map<number, { account: AccountWithLinks; at: number }>();

	async init(): Promise<void> {
		this.sql = this.container.getService("SQL");
		await this.sql.queryPool(`
			CREATE TABLE IF NOT EXISTS accounts (
				id BIGSERIAL PRIMARY KEY,
				display_name TEXT NOT NULL,
				avatar TEXT NOT NULL DEFAULT '',
				roles JSONB NOT NULL DEFAULT '[]',
				roles_checked_at TIMESTAMPTZ,
				created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				session_version INTEGER NOT NULL DEFAULT 1
			);
			ALTER TABLE accounts ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 1;
			CREATE TABLE IF NOT EXISTS account_links (
				account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
				provider TEXT NOT NULL,
				provider_id TEXT NOT NULL,
				name TEXT NOT NULL,
				avatar TEXT NOT NULL DEFAULT '',
				source TEXT NOT NULL,
				token TEXT,
				linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				PRIMARY KEY (account_id, provider),
				UNIQUE (provider, provider_id)
			);
			-- SSO email capture (Fluxer's OIDC login requires a verified email)
			ALTER TABLE account_links ADD COLUMN IF NOT EXISTS email TEXT;
			ALTER TABLE account_links ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT false;
			CREATE TABLE IF NOT EXISTS link_codes (
				code TEXT PRIMARY KEY,
				account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
				provider TEXT NOT NULL,
				expires_at TIMESTAMPTZ NOT NULL,
				used_at TIMESTAMPTZ
			);
		`);
		await this.migrateDiscordTokens();

		const sweep = () => this.sweepRoles().catch(err => log.error(err, "role sweep failed"));
		setTimeout(sweep, 30 * 1000);
		setInterval(sweep, SWEEP_INTERVAL).unref();
	}

	// #region lookups

	async get(id: number): Promise<AccountWithLinks | undefined> {
		const cached = this.cache.get(id);
		if (cached && Date.now() - cached.at < SESSION_CACHE_TTL) return cached.account;

		const rows = (await this.sql.queryPool("SELECT * FROM accounts WHERE id = $1", [
			id,
		])) as AccountRow[];
		if (!rows[0]) return;
		const links = (await this.sql.queryPool(
			"SELECT * FROM account_links WHERE account_id = $1 ORDER BY linked_at",
			[id]
		)) as LinkRow[];
		const account = { ...toAccount(rows[0]), links: links.map(toLink) };
		this.cache.set(id, { account, at: Date.now() });
		return account;
	}

	async findByLink(
		provider: Provider,
		providerId: string
	): Promise<AccountWithLinks | undefined> {
		const rows = (await this.sql.queryPool(
			"SELECT account_id FROM account_links WHERE provider = $1 AND provider_id = $2",
			[provider, providerId]
		)) as Pick<LinkRow, "account_id">[];
		if (!rows[0]) return;
		return this.get(Number(rows[0].account_id));
	}

	async linkFor(
		provider: Provider,
		providerId: string
	): Promise<(AccountLink & { accountId: number }) | undefined> {
		const rows = (await this.sql.queryPool(
			"SELECT * FROM account_links WHERE provider = $1 AND provider_id = $2",
			[provider, providerId]
		)) as LinkRow[];
		if (!rows[0]) return;
		return { ...toLink(rows[0]), accountId: Number(rows[0].account_id) };
	}

	/**
	 * Accounts with any role and a proven link on the given game platform, what the game
	 * servers rank from. Unlike the website, in game a trial developer is a developer. The
	 * name is the one the platform knows the player by.
	 */
	async staff(
		provider: Provider
	): Promise<{ providerId: string; name: string; roles: Role[] }[]> {
		const rows = (await this.sql.queryPool(
			`SELECT a.roles, l.provider_id, l.name
			 FROM accounts a JOIN account_links l ON l.account_id = a.id
			 WHERE l.provider = $2 AND l.source <> 'import' AND a.roles ?| $1::text[]
			 ORDER BY a.id`,
			[ROLES, provider]
		)) as { roles: Role[]; provider_id: string; name: string }[];
		return rows.map(r => ({ providerId: r.provider_id, name: r.name, roles: r.roles }));
	}

	/** The account behind a proven link, or undefined. */
	async byLink(provider: Provider, providerId: string): Promise<AccountWithLinks | undefined> {
		const link = await this.linkFor(provider, providerId);
		if (!link || link.source === "import") return;
		return this.get(link.accountId);
	}

	/** A link that proves ownership, imported ones are display only. */
	static verifiedLink(account: AccountWithLinks, provider: Provider): AccountLink | undefined {
		return account.links.find(l => l.provider === provider && l.source !== "import");
	}

	// #endregion

	// #region writes

	private invalidate(id: number): void {
		this.cache.delete(id);
	}

	async create(link: LinkInput): Promise<AccountWithLinks> {
		const rows = (await this.sql.queryPool(
			"INSERT INTO accounts (display_name, avatar) VALUES ($1, $2) RETURNING *",
			[link.name, link.avatar ?? ""]
		)) as AccountRow[];
		const id = Number(rows[0].id);
		await this.upsertLink(id, link);
		log.info(`account ${id} created from ${link.provider} ${link.providerId} (${link.name})`);
		return (await this.get(id)) as AccountWithLinks;
	}

	private async upsertLink(accountId: number, link: LinkInput): Promise<void> {
		await this.sql.queryPool(
			`INSERT INTO account_links (account_id, provider, provider_id, name, avatar, source, token, email, email_verified)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
			 ON CONFLICT (account_id, provider) DO UPDATE SET
				provider_id = EXCLUDED.provider_id, name = EXCLUDED.name, avatar = EXCLUDED.avatar,
				source = EXCLUDED.source, token = EXCLUDED.token, linked_at = now(),
				email = COALESCE(EXCLUDED.email, account_links.email),
				email_verified = COALESCE(EXCLUDED.email_verified, account_links.email_verified)`,
			[
				accountId,
				link.provider,
				link.providerId,
				link.name,
				link.avatar ?? "",
				link.source,
				link.token ? encrypt(link.token) : null,
				link.email ?? null,
				link.emailVerified ?? null,
			]
		);
		this.invalidate(accountId);
	}

	/**
	 * Attaches a platform to an account. Re-linking the same platform id refreshes the
	 * name, avatar and token; a platform id owned by another account is refused.
	 */
	/**
	 * Attaches a platform to an account. Re-linking the same platform id refreshes the
	 * name, avatar and token. A platform id owned by another account is absorbed when
	 * that account has no other proven way to log in (someone who signed up twice, once
	 * per platform): the caller has just proven the platform, so everything on the other
	 * account is theirs. Otherwise the link is refused and they unlink from the other side.
	 */
	async addLink(accountId: number, link: LinkInput): Promise<AccountWithLinks> {
		const owner = await this.linkFor(link.provider, link.providerId);
		if (owner && owner.accountId !== accountId) {
			const other = await this.get(owner.accountId);
			if (!other || !Accounts.onlyLoginIs(other, link.provider)) {
				throw new LinkConflictError(link.provider);
			}
			await this.absorb(accountId, other);
		}
		await this.upsertLink(accountId, link);
		return this.refreshRoles(accountId);
	}

	/** True when the account's only proven login platform is `provider`. */
	static onlyLoginIs(account: AccountWithLinks, provider: Provider): boolean {
		return account.links
			.filter(l => LOGIN_PROVIDERS.includes(l.provider) && l.source !== "import")
			.every(l => l.provider === provider);
	}

	/**
	 * Moves every link of `other` onto `intoId` (platforms the target already has are
	 * dropped, the target's win) and deletes `other`. Its sessions die with it.
	 */
	private async absorb(intoId: number, other: AccountWithLinks): Promise<void> {
		const into = await this.get(intoId);
		if (!into) throw new Error("no such account");
		const taken = new Set(into.links.map(l => l.provider));
		const moved: string[] = [];
		for (const link of other.links) {
			if (taken.has(link.provider)) continue;
			await this.sql.queryPool(
				"UPDATE account_links SET account_id = $1 WHERE account_id = $2 AND provider = $3",
				[intoId, other.id, link.provider]
			);
			moved.push(link.provider);
		}
		await this.sql.queryPool("DELETE FROM accounts WHERE id = $1", [other.id]);
		this.invalidate(other.id);
		this.invalidate(intoId);
		log.info(
			`account ${other.id} (${other.displayName}) merged into ${intoId}, moved ${moved.join(", ") || "nothing"}`
		);
	}

	async removeLink(accountId: number, provider: Provider): Promise<AccountWithLinks> {
		const account = await this.get(accountId);
		if (!account) throw new Error("no such account");
		const remaining = account.links.filter(
			l => l.provider !== provider && LOGIN_PROVIDERS.includes(l.provider)
		);
		if (!remaining.length) throw new LastLoginError();

		await this.sql.queryPool(
			"DELETE FROM account_links WHERE account_id = $1 AND provider = $2",
			[accountId, provider]
		);
		this.invalidate(accountId);
		return this.refreshRoles(accountId);
	}

	/**
	 * Every OAuth/OpenID callback ends here: with a session the platform is linked to
	 * that account, without one the platform logs into its account or creates one.
	 */
	async loginOrLink(
		sessionAccountId: number | undefined,
		link: LinkInput
	): Promise<AccountWithLinks> {
		if (sessionAccountId !== undefined) {
			const account = await this.get(sessionAccountId);
			if (account) return this.addLink(account.id, link);
		}
		const existing = await this.findByLink(link.provider, link.providerId);
		if (existing) {
			const matched = existing.links.find(l => l.provider === link.provider);
			await this.upsertLink(existing.id, link);
			// the platform someone logs in with is the face of the account
			await this.sql.queryPool(
				"UPDATE accounts SET display_name = $1, avatar = $2 WHERE id = $3",
				[link.name, link.avatar ?? "", existing.id]
			);
			// the first proven login claims an imported account; the other imported links
			// were never proven to belong to the same person, so they go back to being unlinked
			if (matched?.source === "import") {
				const dropped = await this.sql.queryPool(
					"DELETE FROM account_links WHERE account_id = $1 AND source = 'import' RETURNING provider",
					[existing.id]
				);
				if (dropped.length) {
					log.info(
						`account ${existing.id} claimed through ${link.provider}, dropped imported ${dropped.map(r => r.provider).join(", ")}`
					);
				}
			}
			return this.refreshRoles(existing.id);
		}
		const created = await this.create(link);
		return this.refreshRoles(created.id);
	}

	/** Invalidates every session cookie of the account. */
	async bumpSessionVersion(accountId: number): Promise<number> {
		const rows = (await this.sql.queryPool(
			"UPDATE accounts SET session_version = session_version + 1 WHERE id = $1 RETURNING session_version",
			[accountId]
		)) as { session_version: number }[];
		this.invalidate(accountId);
		return rows[0]?.session_version ?? 0;
	}

	async setGithubToken(accountId: number, token: GithubToken): Promise<void> {
		await this.sql.queryPool(
			"UPDATE account_links SET token = $1 WHERE account_id = $2 AND provider = 'github'",
			[encrypt(token), accountId]
		);
		this.invalidate(accountId);
	}

	static githubToken(account: AccountWithLinks): GithubToken | undefined {
		const raw = account.links.find(l => l.provider === "github")?.token;
		return raw ? decrypt<GithubToken>(raw) : undefined;
	}

	// #endregion

	// #region roles

	/** Recomputes when stale, otherwise returns the cached roles. */
	async ensureRoles(account: AccountWithLinks): Promise<AccountWithLinks> {
		if (Date.now() - account.rolesCheckedAt < ROLES_TTL) return account;
		return this.refreshRoles(account.id);
	}

	async refreshRoles(accountId: number): Promise<AccountWithLinks> {
		this.invalidate(accountId);
		const account = await this.get(accountId);
		if (!account) throw new Error("no such account");

		const roles = await this.computeRoles(account).catch(err => {
			log.error(err, `role computation failed for account ${accountId}`);
			return undefined;
		});
		// a failed lookup keeps the previous roles rather than silently demoting anyone,
		// and is retried after a short while instead of on every request
		if (!roles) {
			await this.sql.queryPool(
				"UPDATE accounts SET roles_checked_at = now() - ($1 || ' milliseconds')::interval WHERE id = $2",
				[String(ROLES_TTL - ROLES_RETRY), accountId]
			);
			this.invalidate(accountId);
			return account;
		}
		return this.storeRoles(account, roles);
	}

	/** Writes the roles, and pushes Linked Roles metadata when the set changed. */
	private async storeRoles(account: AccountWithLinks, roles: Role[]): Promise<AccountWithLinks> {
		await this.sql.queryPool(
			"UPDATE accounts SET roles = $1::jsonb, roles_checked_at = now() WHERE id = $2",
			[JSON.stringify(roles), account.id]
		);
		this.invalidate(account.id);
		const fresh = (await this.get(account.id)) as AccountWithLinks;
		if (roles.join() !== account.roles.join()) {
			log.info(
				`account ${account.id} (${account.displayName}) roles: ${roles.join(", ") || "none"}`
			);
			await this.pushLinkedRoles(fresh);
		}
		return fresh;
	}

	private sweeping = false;

	/**
	 * Recomputes every account's roles without anyone visiting the site, so a GitHub team
	 * or Steam group change reaches Discord and the game servers within SWEEP_INTERVAL. One member listing
	 * per team (a few paginated calls) answers for all accounts, the Steam groups are cached,
	 * and a push only follows a change, so the cost does not grow with the account count.
	 */
	async sweepRoles(): Promise<void> {
		if (this.sweeping) return;
		this.sweeping = true;
		try {
			const members = await this.teamMembers();
			const rows = (await this.sql.queryPool(
				"SELECT DISTINCT account_id FROM account_links WHERE provider IN ('github', 'steam') AND source <> 'import'"
			)) as { account_id: string }[];

			let changed = 0;
			for (const row of rows) {
				this.invalidate(Number(row.account_id));
				const account = await this.get(Number(row.account_id));
				if (!account) continue;
				const roles = await this.computeRoles(account, members);
				if (roles.join() !== account.roles.join()) changed++;
				await this.storeRoles(account, roles);
			}
			log.info(`role sweep: ${rows.length} accounts checked, ${changed} changed`);
		} finally {
			this.sweeping = false;
		}
	}

	/** Lowercased logins per team, from the app installation. Throws when any listing fails. */
	private async teamMembers(): Promise<Map<string, Set<string>>> {
		const app = this.container.tryService("Github")?.octokit;
		if (!app) {
			// no Github service: nothing is role-proven, everyone keeps their roles
			log.warn("role sweep skipped: Github is not enabled");
			return new Map();
		}
		const members = new Map<string, Set<string>>();
		for (const team of Object.keys(TEAM_ROLES)) {
			const logins = await app.paginate(app.teams.listMembersInOrg, {
				org: GithubConfig.org,
				team_slug: team,
				per_page: 100,
			});
			members.set(team, new Set(logins.map(m => m.login.toLowerCase())));
		}
		return members;
	}

	/** Discord Linked Roles carry a dev flag derived from the roles, so a change is pushed at once. */
	private async pushLinkedRoles(account: AccountWithLinks): Promise<void> {
		const discord = account.links.find(l => l.provider === "discord");
		if (!discord) return;
		await this.container
			.getService("DiscordMetadata")
			.update(discord.providerId)
			.catch(err => log.warn(err, `linked roles push failed for account ${account.id}`));
	}

	/**
	 * With `members` (a sweep) team membership comes from the listings, otherwise from
	 * one membership call per team for this account.
	 */
	private async computeRoles(
		account: AccountWithLinks,
		members?: Map<string, Set<string>>
	): Promise<Role[]> {
		const roles = new Set<Role>();

		const github = Accounts.verifiedLink(account, "github");
		if (github) {
			const teams = members
				? [...members.entries()]
						.filter(([, logins]) => logins.has(github.name.toLowerCase()))
						.map(([team]) => team)
				: await this.githubTeams(github, account);
			for (const team of teams) {
				const role = TEAM_ROLES[team];
				if (role) roles.add(role);
			}
		}

		const steam = Accounts.verifiedLink(account, "steam");
		if (steam) {
			for (const [groupId, role] of Object.entries(STEAM_GROUP_ROLES)) {
				if (await isSteamGroupMember(groupId, steam.providerId)) roles.add(role);
			}
		}

		return ROLES.filter(r => roles.has(r));
	}

	/**
	 * Teams of github.json's org the GitHub login is an active member of. Read with the
	 * GitHub App installation (needs the org "Members: read" permission), falling back to
	 * the user's own token when the app is not allowed to.
	 */
	private async githubTeams(link: AccountLink, account: AccountWithLinks): Promise<string[]> {
		const app = this.container.tryService("Github")?.octokit;
		if (!app) return []; // no Github service: no team-proven roles
		const userToken = await this.freshGithubToken(account);
		const user = userToken ? new Octokit({ auth: userToken.accessToken }) : undefined;

		const teams: string[] = [];
		for (const team of Object.keys(TEAM_ROLES)) {
			let active = await this.teamMembership(app, team, link.name);
			if (active === undefined && user)
				active = await this.teamMembership(user, team, link.name);
			// no client could answer: keep the previous roles rather than demote on an outage
			if (active === undefined) throw new Error(`team lookup unavailable for ${team}`);
			if (active) teams.push(team);
		}
		return teams;
	}

	/** true/false for a definite answer, undefined when this client is not allowed to ask. */
	private async teamMembership(
		client: Octokit,
		team: string,
		login: string
	): Promise<boolean | undefined> {
		try {
			const { data } = await client.teams.getMembershipForUserInOrg({
				org: GithubConfig.org,
				team_slug: team,
				username: login,
			});
			return data.state === "active";
		} catch (err) {
			const status = (err as { status?: number }).status;
			if (status === 404) return false;
			log.warn(err, `team membership check failed for ${login} in ${team}`);
			return undefined;
		}
	}

	/** The stored GitHub user token, refreshed first when the app expires them. */
	async freshGithubToken(account: AccountWithLinks): Promise<GithubToken | undefined> {
		const token = Accounts.githubToken(account);
		if (!token) return;
		if (!token.expiresAt || token.expiresAt > Date.now() + 60_000) return token;
		if (!token.refreshToken) return;

		const res = await fetch("https://github.com/login/oauth/access_token", {
			method: "POST",
			headers: { Accept: "application/json", "Content-Type": "application/json" },
			body: JSON.stringify({
				client_id: GithubConfig.clientId,
				client_secret: GithubConfig.clientSecret,
				grant_type: "refresh_token",
				refresh_token: token.refreshToken,
			}),
		}).catch(err => {
			log.error(err, "github token refresh failed");
		});
		const body = res?.ok
			? ((await res.json()) as {
					access_token?: string;
					refresh_token?: string;
					expires_in?: number;
				})
			: undefined;
		if (!body?.access_token) return;

		const fresh = Accounts.tokenFromResponse(body);
		await this.setGithubToken(account.id, fresh);
		return fresh;
	}

	static tokenFromResponse(body: {
		access_token?: string;
		refresh_token?: string;
		expires_in?: number;
	}): GithubToken {
		return {
			accessToken: body.access_token as string,
			refreshToken: body.refresh_token,
			expiresAt: body.expires_in ? Date.now() + body.expires_in * 1000 : undefined,
		};
	}

	// #endregion

	// #region in-game link codes

	async createLinkCode(
		accountId: number,
		provider: Provider
	): Promise<{ code: string; expiresAt: number }> {
		if (!CODE_PROVIDERS.includes(provider))
			throw new Error(`${provider} cannot be linked in game`);
		const bytes = crypto.randomBytes(CODE_LENGTH);
		let code = "";
		for (const b of bytes) code += CODE_ALPHABET[b % CODE_ALPHABET.length];
		const expiresAt = Date.now() + CODE_TTL;

		// one open code per account and provider, and expired ones do not pile up
		await this.sql.queryPool(
			"DELETE FROM link_codes WHERE (account_id = $1 AND provider = $2) OR expires_at < now()",
			[accountId, provider]
		);
		await this.sql.queryPool(
			"INSERT INTO link_codes (code, account_id, provider, expires_at) VALUES ($1, $2, $3, $4)",
			[code, accountId, provider, new Date(expiresAt)]
		);
		return { code, expiresAt };
	}

	/**
	 * Called from the game chat relays with the identity the game server vouches for.
	 * Returns the account on success, a reason otherwise.
	 */
	async redeemLinkCode(
		code: string,
		provider: Provider,
		providerId: string,
		name: string,
		avatar?: string
	): Promise<{ account: AccountWithLinks } | { error: string }> {
		const rows = (await this.sql.queryPool(
			`UPDATE link_codes SET used_at = now()
			 WHERE code = $1 AND provider = $2 AND used_at IS NULL AND expires_at > now()
			 RETURNING account_id`,
			[code.toUpperCase(), provider]
		)) as { account_id: string }[];
		if (!rows[0]) return { error: "unknown or expired code" };

		const accountId = Number(rows[0].account_id);
		try {
			const account = await this.addLink(accountId, {
				provider,
				providerId,
				name,
				avatar,
				source: "ingame",
			});
			log.info(`account ${accountId} linked ${provider} ${providerId} (${name}) from game`);
			return { account };
		} catch (err) {
			if (err instanceof LinkConflictError) return { error: err.message };
			throw err;
		}
	}

	// #endregion

	/**
	 * One-time import of the Discord Linked Roles users: each discord_tokens row becomes
	 * an account with import-sourced links. Rows whose Discord id already has a link are
	 * skipped, so this is safe to run on every start.
	 */
	private async migrateDiscordTokens(): Promise<void> {
		const db = this.sql.getLocalDatabase();
		if (!(await this.sql.tableExists("discord_tokens"))) return;
		const rows = await db.all<{ user_id: string; steam_id: string | null }[]>(
			"SELECT user_id, steam_id FROM discord_tokens"
		);
		let created = 0;
		for (const row of rows) {
			if (await this.linkFor("discord", row.user_id)) continue;
			const account = await this.create({
				provider: "discord",
				providerId: row.user_id,
				name: row.user_id,
				source: "import",
			});
			if (row.steam_id && !(await this.linkFor("steam", row.steam_id))) {
				await this.upsertLink(account.id, {
					provider: "steam",
					providerId: row.steam_id,
					name: row.steam_id,
					source: "import",
				});
			}
			created++;
		}
		if (created) log.info(`imported ${created} accounts from discord_tokens`);
	}
}

export default (container: Container): Service => {
	return new Accounts(container);
};
