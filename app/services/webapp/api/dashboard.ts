import type { NextFunction, Request, Response } from "express";
import { WebApp } from "@/app/services/webapp/index.js";
import { logBuffer, LogLine } from "@/app/services/webapp/dashboard/LogBuffer.js";
import { rateLimitKeyGenerator } from "@/app/services/webapp/rateLimit.js";
import { EditorSession, getSession, getSessionFromCookieHeader } from "./github-auth.js";
import { rateLimit } from "express-rate-limit";
import { ChildProcess, spawn } from "child_process";
import { connection as WebSocketConnection } from "websocket";
import { promises as fs } from "fs";
import express from "express";
import path from "path";
import pug from "pug";
import util from "util";
import { logger } from "@/utils.js";

const log = logger(import.meta);

/**
 * Admin dashboard served at `/`: live process output, a JS / bash REPL over a
 * websocket and an editor for the config files. Everything is behind the GitHub
 * team login from github-auth.ts.
 */

// only this history.json team gets the dashboard, the others can still edit the website
const ADMIN_TEAM = "administrators";
const isDashboardAdmin = (session?: EditorSession): session is EditorSession =>
	!!session?.teams?.includes(ADMIN_TEAM);

const VIEW_DIR = path.join(process.cwd(), "resources", "dashboard");
// the directory the running code imports its JSON from (dist/config in prod, config/ in dev)
const CONFIG_DIR = new URL("../../../../config/", import.meta.url);
const CONFIG_NAME = /^[a-z0-9][a-z0-9.-]*\.json$/i;

const isConfigFile = (name: string): boolean =>
	CONFIG_NAME.test(name) && !name.endsWith(".example.json");

const listConfigs = async (): Promise<{ name: string; content: unknown; error?: string }[]> => {
	const names = (await fs.readdir(CONFIG_DIR)).filter(isConfigFile).sort();
	return Promise.all(
		names.map(async name => {
			try {
				const content = JSON.parse(await fs.readFile(new URL(name, CONFIG_DIR), "utf8"));
				return { name, content };
			} catch (err) {
				return { name, content: null, error: (err as Error).message };
			}
		})
	);
};

const writeConfig = async (name: string, content: unknown): Promise<void> => {
	const target = new URL(name, CONFIG_DIR);
	const tmp = new URL(name + ".tmp", CONFIG_DIR);
	await fs.writeFile(tmp, JSON.stringify(content, null, "\t") + "\n", "utf8");
	await fs.rename(tmp, target);
};

const changedKeys = (before: unknown, after: unknown): string[] => {
	const a = (before ?? {}) as Record<string, unknown>;
	const b = (after ?? {}) as Record<string, unknown>;
	return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(
		k => JSON.stringify(a[k]) !== JSON.stringify(b[k])
	);
};

// #region REPL

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as FunctionConstructor;

/** Evaluates code in the process, with access to globals (MetaConcord, process, ...). */
const evalJs = async (code: string): Promise<string> => {
	type Fn = (...args: unknown[]) => Promise<unknown>;
	const compile = (src: string): Fn | undefined => {
		try {
			return new AsyncFunction(src) as Fn;
		} catch {
			return undefined;
		}
	};
	// the value of the last statement is returned, like a REPL would
	const statements = code.trim().replace(/;\s*$/, "");
	const split = Math.max(statements.lastIndexOf(";"), statements.lastIndexOf("\n"));
	const fn =
		compile(`return (${statements}\n);`) ??
		(split > 0
			? compile(
					`${statements.slice(0, split + 1)}\nreturn (${statements.slice(split + 1)}\n);`
				)
			: undefined) ??
		new AsyncFunction(code);
	const result = await fn();
	return typeof result === "string" ? result : util.inspect(result, { depth: 3, colors: false });
};

type ClientMessage =
	{ type: "js"; code: string } | { type: "bash"; input: string } | { type: "bash:kill" };

class DashboardSession {
	private bash?: ChildProcess;
	private bashAlive = false;

	constructor(
		private conn: WebSocketConnection,
		private user: EditorSession
	) {
		const onLine = (line: LogLine) => this.send({ type: "log", ...line });
		logBuffer.on("line", onLine);
		// the session was only checked at upgrade time, close the socket once it expires
		const expiry = setTimeout(() => {
			this.send({ type: "out", mode: "meta", text: "session expired, log in again" });
			conn.close(4001, "session expired");
		}, Math.max(0, user.expiresAt - Date.now()));
		conn.on("close", () => {
			clearTimeout(expiry);
			logBuffer.off("line", onLine);
			if (this.bash?.pid && this.bashAlive) {
				try {
					process.kill(-this.bash.pid, "SIGKILL");
				} catch {
					// already gone
				}
			}
		});
		conn.on("message", msg => {
			if (msg.type !== "utf8") return;
			let parsed: ClientMessage;
			try {
				parsed = JSON.parse(msg.utf8Data);
			} catch {
				return;
			}
			this.handle(parsed).catch(err => log.error(err, "dashboard message failed"));
		});
	}

	private send(data: unknown): void {
		if (this.conn.connected) this.conn.sendUTF(JSON.stringify(data));
	}

	private out(mode: string, text: string): void {
		this.send({ type: "out", mode, text });
	}

	private async handle(msg: ClientMessage): Promise<void> {
		if (this.user.expiresAt < Date.now()) {
			this.conn.close(4001, "session expired");
			return;
		}
		switch (msg.type) {
			case "js": {
				if (typeof msg.code !== "string") return;
				log.warn({ login: this.user.login, mode: "js" }, msg.code);
				try {
					this.out("result", await evalJs(msg.code));
				} catch (err) {
					this.out("error", util.inspect(err));
				}
				return;
			}
			case "bash": {
				if (typeof msg.input !== "string") return;
				log.warn({ login: this.user.login, mode: "bash" }, msg.input);
				this.ensureBash().stdin?.write(msg.input + "\n");
				return;
			}
			case "bash:kill": {
				// signal the whole process group so the foreground command dies too,
				// bash exits with it and is respawned on the next input
				if (this.bash?.pid && this.bashAlive) {
					try {
						const pid = this.bash.pid;
						process.kill(-pid, "SIGINT");
						setTimeout(() => {
							if (this.bash?.pid === pid && this.bashAlive)
								process.kill(-pid, "SIGKILL");
						}, 2000);
					} catch {
						// already gone
					}
				}
				return;
			}
		}
	}

	private ensureBash(): ChildProcess {
		if (this.bash && this.bashAlive) return this.bash;
		const child = spawn("bash", ["--norc", "--noprofile"], {
			cwd: process.cwd(),
			env: { ...process.env, TERM: "dumb" },
			stdio: ["pipe", "pipe", "pipe"],
			detached: true, // own process group, see bash:kill
		});
		child.stdout?.on("data", (d: Buffer) => this.out("stdout", d.toString("utf8")));
		child.stderr?.on("data", (d: Buffer) => this.out("stderr", d.toString("utf8")));
		child.on("exit", (code, signal) => {
			this.bashAlive = false;
			this.send({ type: "exit", code: code ?? signal });
		});
		child.on("error", err => this.out("error", `bash failed to start: ${err.message}`));
		this.bash = child;
		this.bashAlive = true;
		return child;
	}
}

// #endregion

const requireAdmin = (req: Request, res: Response, next: NextFunction): void => {
	const session = getSession(req);
	if (isDashboardAdmin(session)) {
		res.locals.session = session;
		next();
		return;
	}
	if (session) {
		res.status(403).json({ error: `${ADMIN_TEAM} only` });
		return;
	}
	if (req.accepts(["json", "html"]) === "html") {
		res.redirect(`/auth/github?target=self&redirect=${encodeURIComponent(req.path)}`);
	} else {
		res.status(401).json({ error: "not logged in" });
	}
};

export default (webApp: WebApp): void => {
	const limiter = rateLimit({ keyGenerator: rateLimitKeyGenerator, windowMs: 60_000, limit: 60 });
	const view = path.join(VIEW_DIR, "view.pug");
	const login = path.join(VIEW_DIR, "login.pug");

	webApp.app.get("/", (req, res) => {
		res.set("Cache-Control", "no-store");
		const session = getSession(req);
		const admin = isDashboardAdmin(session);
		if (session && !admin) res.status(403);
		res.send(
			pug.renderFile(admin ? view : login, {
				session,
				siteUrl: webApp.config.siteUrl,
				adminTeam: ADMIN_TEAM,
			})
		);
	});

	webApp.app.use("/dashboard/static", express.static(VIEW_DIR, { index: false }));

	webApp.app.get("/dashboard/logs", requireAdmin, (req, res) => {
		res.set("Cache-Control", "no-store");
		const limit = Math.min(Number(req.query.limit) || 500, 2000);
		res.json(logBuffer.recent(limit));
	});

	webApp.app.get("/dashboard/config", requireAdmin, async (_, res) => {
		res.set("Cache-Control", "no-store");
		res.json(await listConfigs());
	});

	webApp.app.put(
		"/dashboard/config/:name",
		limiter,
		requireAdmin,
		express.json({ limit: "1mb" }),
		async (req, res) => {
			const { name } = req.params;
			const session = res.locals.session as EditorSession;
			if (!isConfigFile(name)) {
				res.status(400).json({ error: "invalid config name" });
				return;
			}
			const content = req.body?.content;
			if (!content || typeof content !== "object" || Array.isArray(content)) {
				res.status(400).json({ error: "content must be an object" });
				return;
			}
			let before: unknown;
			try {
				before = JSON.parse(await fs.readFile(new URL(name, CONFIG_DIR), "utf8"));
			} catch {
				before = undefined;
			}
			await writeConfig(name, content);
			log.warn(
				{ login: session.login, keys: changedKeys(before, content) },
				`config ${name} edited`
			);
			res.json({ name, content });
		}
	);

	webApp.app.post("/dashboard/restart", limiter, requireAdmin, (_, res) => {
		const session = res.locals.session as EditorSession;
		log.warn({ login: session.login }, "restart requested from the dashboard");
		res.status(202).json({ ok: true });
		setTimeout(() => process.exit(0), 300);
	});

	webApp.ws.route("/dashboard/ws", req => {
		const session = getSessionFromCookieHeader(req.httpRequest.headers.cookie);
		if (!isDashboardAdmin(session)) {
			req.reject(session ? 403 : 401);
			return;
		}
		if (req.origin !== webApp.config.url && process.env.NODE_ENV === "production") {
			log.warn(`dashboard ws rejected, bad origin ${req.origin} for ${session.login}`);
			req.reject(403);
			return;
		}
		const conn = req.accept(undefined, req.origin);
		log.info(`dashboard ws opened by ${session.login}`);
		new DashboardSession(conn, session);
	});
};
