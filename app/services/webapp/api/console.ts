import { WebApp } from "@/app/services/webapp/index.js";
import GameBridge from "@/app/services/gamebridge/GameBridge.js";
import { GmodConnectionConfig } from "@/app/services/gamebridge/games/gmod/GmodConnection.js";
import { sshConnectOptions } from "@/app/services/gamebridge/games/gmod/GmodStatsProbe.js";
import { statsProbes } from "@/app/services/gamebridge/games/gmod/index.js";
import { MinecraftConnectionConfig } from "@/app/services/gamebridge/games/minecraft/MinecraftConnection.js";
import {
	ConsoleListener,
	consoleHub,
} from "@/app/services/gamebridge/games/minecraft/consoleHub.js";
import { EditorSession, getSession, getSessionFromCookieHeader } from "./github-auth.js";
import { NodeSSH } from "node-ssh";
import type { ClientChannel } from "ssh2";
import { connection as WebSocketConnection } from "websocket";
import HistoryConfig from "@/config/history.json" with { type: "json" };
import gmodServers from "@/config/gmod.servers.json" with { type: "json" };
import minecraftServers from "@/config/minecraft.servers.json" with { type: "json" };
import { logger } from "@/utils.js";

const log = logger(import.meta);

/**
 * "Rocket": the game server console for the website.
 *
 * gmod hosts expose the srcds console on a unix socket (`~/gserv/daemon_socket`,
 * what `gserv show` attaches to), so a websocket from the site is bridged to
 * `socat` on that socket over SSH. Output keeps its ANSI colors, input is one
 * command per line.
 *
 * The Minecraft server has no SSH access; its console is the server log
 * streamed by the metaconcord mod over the game websocket, and commands are
 * run through the mod as the server console (see consoleHub).
 *
 * Servers are addressed by "<game>:<id>" since ids are only unique per game.
 */

const CONSOLE_COMMAND = "cd ~/gserv && exec socat UNIX-CONNECT:daemon_socket stdio";
const MAX_SESSIONS_PER_SERVER = 5;
const MAX_LINES_PER_SECOND = 20;

// gserv verbs the console exposes as buttons, kept to the safe live-update set
const GSERV_ACTIONS = ["rehash", "merge_repos", "rehashskeleton", "update_repos"] as const;

type Game = "gmod" | "minecraft";

type HostedServer = {
	key: string;
	game: Game;
	id: number;
	name: string;
	label?: string;
	gserv: boolean;
};

const canUseConsole = (session?: EditorSession): session is EditorSession =>
	!!session?.teams?.some(team => HistoryConfig.teams.includes(team));

const sessionsPerServer = new Map<string, number>();

/** Auth, session cap, rate limit and framing shared by both console transports. */
abstract class ConsoleSession {
	protected closed = false;
	private lineTimes: number[] = [];
	private expiryTimer: NodeJS.Timeout;

	constructor(
		protected conn: WebSocketConnection,
		protected user: EditorSession,
		protected server: HostedServer
	) {
		sessionsPerServer.set(server.key, (sessionsPerServer.get(server.key) ?? 0) + 1);
		// the session was only checked at upgrade time, close the socket once it expires
		this.expiryTimer = setTimeout(
			() => {
				this.send({ type: "exit", reason: "session expired, log in again" });
				this.close(4001, "session expired");
			},
			Math.max(0, user.expiresAt - Date.now())
		);
		conn.on("close", () => this.close());
		conn.on("message", msg => {
			if (msg.type !== "utf8") return;
			try {
				this.handle(JSON.parse(msg.utf8Data));
			} catch {
				// ignore malformed frames
			}
		});
	}

	/** Attaches the transport. Separate from the constructor so subclass fields exist by then. */
	start(): this {
		this.open().catch(err => {
			log.error({ err, server: this.server.name }, "console open failed");
			this.send({ type: "exit", reason: "could not attach to the console" });
			this.close();
		});
		return this;
	}

	protected send(data: unknown): void {
		if (this.conn.connected) this.conn.sendUTF(JSON.stringify(data));
	}

	protected abstract open(): Promise<void>;
	protected abstract input(line: string): void;
	protected abstract dispose(): void;
	protected runGserv(_command: unknown): void {}

	private handle(msg: { type?: string; line?: unknown; command?: unknown }): void {
		if (this.user.expiresAt < Date.now()) {
			this.close(4001, "session expired");
			return;
		}
		if (msg.type === "gserv") {
			this.runGserv(msg.command);
			return;
		}
		if (msg.type !== "input" || typeof msg.line !== "string") return;
		const now = Date.now();
		this.lineTimes = this.lineTimes.filter(t => now - t < 1000);
		if (this.lineTimes.length >= MAX_LINES_PER_SECOND) {
			this.send({ type: "meta", text: "too many commands, slow down" });
			return;
		}
		this.lineTimes.push(now);
		const line = msg.line.replace(/[\r\n]/g, " ").slice(0, 2000);
		log.warn({ login: this.user.login, server: this.server.name }, line);
		this.input(line);
	}

	protected close(code?: number, description?: string): void {
		if (this.closed) return;
		this.closed = true;
		clearTimeout(this.expiryTimer);
		sessionsPerServer.set(
			this.server.key,
			Math.max(0, (sessionsPerServer.get(this.server.key) ?? 1) - 1)
		);
		this.dispose();
		if (this.conn.connected) this.conn.close(code, description);
	}
}

class SshConsoleSession extends ConsoleSession {
	private ssh = new NodeSSH();
	private channel?: ClientChannel;
	private gservRunning = false;

	constructor(
		conn: WebSocketConnection,
		user: EditorSession,
		server: HostedServer,
		private sshTarget: NonNullable<GmodConnectionConfig["ssh"]>
	) {
		super(conn, user, server);
	}

	protected async open(): Promise<void> {
		await this.ssh.connect(sshConnectOptions(this.sshTarget));
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
		log.info(`console opened on '${this.server.name}' by ${this.user.login}`);
	}

	protected input(line: string): void {
		this.channel?.write(line + "\n");
	}

	/** Runs a gserv verb on the same SSH connection, streaming its output into the terminal. */
	protected runGserv(command: unknown): void {
		if (typeof command !== "string" || !GSERV_ACTIONS.includes(command as never)) return;
		if (this.gservRunning || !this.channel) return;
		this.gservRunning = true;
		log.warn(
			{ login: this.user.login, server: this.server.name, gserv: command },
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

	protected dispose(): void {
		this.channel?.close();
		this.ssh.dispose();
	}
}

class MinecraftConsoleSession extends ConsoleSession {
	private listener?: ConsoleListener;

	constructor(
		conn: WebSocketConnection,
		user: EditorSession,
		server: HostedServer,
		private bridge: GameBridge
	) {
		super(conn, user, server);
	}

	protected async open(): Promise<void> {
		this.listener = event => {
			if (event.type === "meta") {
				this.send({ type: "meta", text: event.text });
				return;
			}
			// levels ride along so the site can color and filter per line
			if (event.lines.length) {
				this.send({ type: "log", lines: event.lines, replay: event.replay });
			}
		};
		consoleHub.subscribe(this.bridge, this.server.id, this.listener);
		this.send({ type: "ready" });
		if (!this.bridge.servers.minecraft[this.server.id]?.wsConnection?.connected) {
			this.send({ type: "meta", text: "server not connected, waiting" });
		}
		log.info(`console opened on '${this.server.name}' by ${this.user.login}`);
	}

	protected input(line: string): void {
		consoleHub
			.command(this.bridge, this.server.id, line)
			.then(sent => {
				if (!sent) this.send({ type: "meta", text: "server not connected" });
			})
			.catch(err => log.warn(err, "console command failed"));
	}

	protected dispose(): void {
		if (this.listener) consoleHub.unsubscribe(this.bridge, this.server.id, this.listener);
	}
}

export default (webApp: WebApp): void => {
	const bridge = () => webApp.container.getService("GameBridge");

	const hostedServers = (): HostedServer[] => [
		...(gmodServers as GmodConnectionConfig[])
			.filter(s => s.ssh)
			.map(s => ({
				key: `gmod:${s.id}`,
				game: "gmod" as const,
				id: s.id,
				name: s.name,
				label: s.label,
				gserv: true,
			})),
		...(minecraftServers as MinecraftConnectionConfig[]).map(s => ({
			key: `minecraft:${s.id}`,
			game: "minecraft" as const,
			id: s.id,
			name: s.name,
			label: s.label,
			gserv: false,
		})),
	];

	const liveConnection = (server: HostedServer) =>
		server.game === "gmod"
			? bridge().servers.gmod[server.id]
			: bridge().servers.minecraft[server.id];

	const isConnected = (server: HostedServer) => !!liveConnection(server)?.wsConnection?.connected;

	webApp.app.get("/console/servers", (req, res) => {
		res.set("Cache-Control", "no-store");
		if (!canUseConsole(getSession(req))) {
			res.status(401).json({ error: "not allowed" });
			return;
		}
		res.json(
			hostedServers().map(s => ({
				...s,
				connected: isConnected(s),
				map: liveConnection(s)?.mapName,
				players: liveConnection(s)?.status?.players?.length ?? 0,
			}))
		);
	});

	webApp.app.get("/console/status/:key", (req, res) => {
		res.set("Cache-Control", "no-store");
		if (!canUseConsole(getSession(req))) {
			res.status(401).json({ error: "not allowed" });
			return;
		}
		const server = hostedServers().find(s => s.key === req.params.key);
		if (!server) {
			res.status(404).json({ error: "unknown server" });
			return;
		}
		const connected = isConnected(server);
		const history = bridge().statsFor(server.game, server.id);
		const current = history.latest();
		const stats = { current, history: history.toArray() };

		if (server.game === "gmod") {
			const conn = bridge().servers.gmod[server.id];
			res.json({
				connected,
				game: server.game,
				map: conn?.mapName,
				players: current?.players ?? conn?.status?.players?.length ?? 0,
				max: statsProbes.get(server.id)?.maxPlayers,
				tick: connected ? { label: "fps", value: current?.tick } : undefined,
				stats,
			});
			return;
		}

		const conn = bridge().servers.minecraft[server.id];
		res.json({
			connected,
			game: server.game,
			players: current?.players ?? conn?.status?.players?.length ?? 0,
			max: conn?.lastStatus?.maxPlayers,
			tick: connected ? { label: "tps", value: current?.tick } : undefined,
			mspt: connected ? conn?.lastMspt : undefined,
			stats,
		});
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
		const key = new URL(req.httpRequest.url ?? "/", "http://x").searchParams.get("server");
		const server = hostedServers().find(s => s.key === key);
		if (!server) {
			req.reject(404);
			return;
		}
		if ((sessionsPerServer.get(server.key) ?? 0) >= MAX_SESSIONS_PER_SERVER) {
			req.reject(429);
			return;
		}
		const conn = req.accept(undefined, req.origin);
		if (server.game === "gmod") {
			const ssh = (gmodServers as GmodConnectionConfig[]).find(s => s.id === server.id)?.ssh;
			if (!ssh) {
				conn.close();
				return;
			}
			new SshConsoleSession(conn, session, server, ssh).start();
		} else {
			new MinecraftConsoleSession(conn, session, server, bridge()).start();
		}
	});
};
