import { WebApp } from "@/app/services/webapp/index.js";
import GmodConnection from "@/app/services/gamebridge/games/gmod/GmodConnection.js";
import { EditorSession, getSession, getSessionFromCookieHeader } from "./github-auth.js";
import { NodeSSH } from "node-ssh";
import type { ClientChannel } from "ssh2";
import { connection as WebSocketConnection } from "websocket";
import HistoryConfig from "@/config/history.json" with { type: "json" };
import sshConfig from "@/config/ssh.json" with { type: "json" };
import { logger } from "@/utils.js";

const log = logger(import.meta);

/**
 * "Rocket": the gmod server console for the website. The game hosts expose the
 * srcds console on a unix socket (`~/gserv/daemon_socket`, what `gserv show`
 * attaches to), so a websocket from the site is bridged to `socat` on that
 * socket over SSH. Output keeps its ANSI colors, input is one command per line.
 */

const CONSOLE_COMMAND = "cd ~/gserv && exec socat UNIX-CONNECT:daemon_socket stdio";
const MAX_SESSIONS_PER_SERVER = 5;
const MAX_LINES_PER_SECOND = 20;

// gserv verbs the console exposes as buttons, kept to the safe live-update set
const GSERV_ACTIONS = ["rehash", "merge_repos", "rehashskeleton", "update_repos"] as const;

// one lua round-trip for the status bar: fps, current and max players
const STATUS_LUA =
	"return util.TableToJSON({fps=math.floor(1/FrameTime()),players=player.GetCount(),max=game.MaxPlayers()})";

const canUseConsole = (session?: EditorSession): session is EditorSession =>
	!!session?.teams?.some(team => HistoryConfig.teams.includes(team));

const sessionsPerServer = new Map<number, number>();

class ConsoleSession {
	private ssh = new NodeSSH();
	private channel?: ClientChannel;
	private closed = false;
	private lineTimes: number[] = [];
	private gservRunning = false;

	constructor(
		private conn: WebSocketConnection,
		private user: EditorSession,
		private server: GmodConnection
	) {
		sessionsPerServer.set(server.config.id, (sessionsPerServer.get(server.config.id) ?? 0) + 1);
		conn.on("close", () => this.close());
		conn.on("message", msg => {
			if (msg.type !== "utf8") return;
			try {
				this.handle(JSON.parse(msg.utf8Data));
			} catch {
				// ignore malformed frames
			}
		});
		this.open().catch(err => {
			log.error({ err, server: server.config.name }, "console ssh failed");
			this.send({ type: "exit", reason: "ssh connection failed" });
			this.close();
		});
	}

	private send(data: unknown): void {
		if (this.conn.connected) this.conn.sendUTF(JSON.stringify(data));
	}

	private async open(): Promise<void> {
		const { ssh } = this.server.config;
		if (!ssh) throw new Error("server has no ssh config");
		await this.ssh.connect({
			host: ssh.host,
			port: ssh.port,
			username: ssh.username,
			// ssh.json keyPath, or the ssh agent when it is empty (local dev)
			...(sshConfig.keyPath
				? { privateKeyPath: sshConfig.keyPath }
				: { agent: process.env.SSH_AUTH_SOCK }),
		});
		if (this.closed) {
			this.ssh.dispose();
			return;
		}
		const channel = await new Promise<ClientChannel>((resolve, reject) => {
			this.ssh.connection?.exec(CONSOLE_COMMAND, (err, stream) =>
				err ? reject(err) : resolve(stream)
			);
		});
		this.channel = channel;
		channel.on("data", (chunk: Buffer) =>
			this.send({ type: "data", data: chunk.toString("utf8") })
		);
		channel.stderr.on("data", (chunk: Buffer) =>
			this.send({ type: "data", data: chunk.toString("utf8") })
		);
		channel.on("close", () => {
			this.send({ type: "exit", reason: "console closed" });
			this.close();
		});
		this.send({ type: "ready" });
		log.info(`console opened on '${this.server.config.name}' by ${this.user.login}`);
	}

	private handle(msg: { type?: string; line?: unknown; command?: unknown }): void {
		if (msg.type === "gserv") {
			this.runGserv(msg.command);
			return;
		}
		if (msg.type !== "input" || typeof msg.line !== "string" || !this.channel) return;
		const now = Date.now();
		this.lineTimes = this.lineTimes.filter(t => now - t < 1000);
		if (this.lineTimes.length >= MAX_LINES_PER_SECOND) {
			this.send({ type: "meta", text: "too many commands, slow down" });
			return;
		}
		this.lineTimes.push(now);
		const line = msg.line.replace(/[\r\n]/g, " ").slice(0, 2000);
		log.warn({ login: this.user.login, server: this.server.config.name }, line);
		this.channel.write(line + "\n");
	}

	/** Runs a gserv verb on the same SSH connection, streaming its output into the terminal. */
	private runGserv(command: unknown): void {
		if (typeof command !== "string" || !GSERV_ACTIONS.includes(command as never)) return;
		if (this.gservRunning) return;
		this.gservRunning = true;
		log.warn(
			{ login: this.user.login, server: this.server.config.name, gserv: command },
			"gserv action"
		);
		this.send({ type: "data", data: `\r\n\x1b[1;35m> gserv ${command}\x1b[0m\r\n` });
		this.ssh
			.execCommand(`gserv ${command}`, {
				onStdout: (chunk: Buffer) =>
					this.send({ type: "data", data: chunk.toString("utf8") }),
				onStderr: (chunk: Buffer) =>
					this.send({ type: "data", data: chunk.toString("utf8") }),
			})
			.then(result => {
				const ok = !result.stderr.includes("GSERV FAILED") && result.code === 0;
				this.send({ type: "data", data: `\x1b[1;35m> gserv ${command} done\x1b[0m\r\n` });
				this.send({ type: "gserv-done", command, ok });
			})
			.catch(err => {
				this.send({
					type: "data",
					data: `\x1b[31mgserv failed: ${err.message}\x1b[0m\r\n`,
				});
				this.send({ type: "gserv-done", command, ok: false });
			})
			.finally(() => (this.gservRunning = false));
	}

	private close(): void {
		if (this.closed) return;
		this.closed = true;
		sessionsPerServer.set(
			this.server.config.id,
			Math.max(0, (sessionsPerServer.get(this.server.config.id) ?? 1) - 1)
		);
		this.channel?.close();
		this.ssh.dispose();
		if (this.conn.connected) this.conn.close();
	}
}

export default (webApp: WebApp): void => {
	const hostedServers = () =>
		webApp.container.getService("GameBridge").servers.gmod.filter(s => s?.config.ssh);

	webApp.app.get("/console/servers", (req, res) => {
		res.set("Cache-Control", "no-store");
		if (!canUseConsole(getSession(req))) {
			res.status(401).json({ error: "not allowed" });
			return;
		}
		res.json(
			hostedServers().map(s => ({
				id: s.config.id,
				name: s.config.name,
				label: s.config.label,
				connected: !!s.wsConnection?.connected,
				map: s.mapName,
				players: s.status?.players?.length ?? 0,
			}))
		);
	});

	webApp.app.get("/console/status/:id", async (req, res) => {
		res.set("Cache-Control", "no-store");
		if (!canUseConsole(getSession(req))) {
			res.status(401).json({ error: "not allowed" });
			return;
		}
		const server = hostedServers().find(s => s.config.id === Number(req.params.id));
		if (!server) {
			res.status(404).json({ error: "unknown server" });
			return;
		}
		const base = { map: server.mapName, players: server.status?.players?.length ?? 0 };
		if (!server.wsConnection?.connected) {
			res.json({ connected: false, ...base });
			return;
		}
		try {
			const result = await server.sendLua(STATUS_LUA);
			const parsed = JSON.parse(result?.data.returns?.[0] ?? "{}");
			res.json({
				connected: true,
				map: base.map,
				players: parsed.players ?? base.players,
				max: parsed.max,
				fps: parsed.fps,
			});
		} catch {
			res.json({ connected: true, ...base });
		}
	});

	webApp.ws.route("/console/ws", req => {
		const session = getSessionFromCookieHeader(req.httpRequest.headers.cookie);
		if (!canUseConsole(session)) {
			req.reject(session ? 403 : 401);
			return;
		}
		const allowed = [...webApp.config.allowedOrigins, webApp.config.url];
		if (!allowed.includes(req.origin) && process.env.NODE_ENV === "production") {
			log.warn(`console ws rejected, bad origin ${req.origin} for ${session.login}`);
			req.reject(403);
			return;
		}
		const id = Number(
			new URL(req.httpRequest.url ?? "/", "http://x").searchParams.get("server")
		);
		const server = hostedServers().find(s => s.config.id === id);
		if (!server) {
			req.reject(404);
			return;
		}
		if ((sessionsPerServer.get(id) ?? 0) >= MAX_SESSIONS_PER_SERVER) {
			req.reject(429);
			return;
		}
		new ConsoleSession(req.accept(undefined, req.origin), session, server);
	});
};
