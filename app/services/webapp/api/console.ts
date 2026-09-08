import { WebApp } from "@/app/services/webapp/index.js";
import GameBridge from "@/app/services/gamebridge/GameBridge.js";
import { GmodConnectionConfig } from "@/app/services/gamebridge/games/gmod/GmodConnection.js";
import { statsProbes } from "@/app/services/gamebridge/games/gmod/index.js";
import { MinecraftConnectionConfig } from "@/app/services/gamebridge/games/minecraft/MinecraftConnection.js";
import { ConsoleGame, ConsoleListener, consoleHub } from "@/app/services/gamebridge/consoleHub.js";
import {
	EditorSession,
	getSession,
	getSessionFromCookieHeader,
	isTeamMember,
} from "./auth/github.js";
import { connection as WebSocketConnection } from "websocket";
import gmodServers from "@/config/gmod.servers.json" with { type: "json" };
import minecraftServers from "@/config/minecraft.servers.json" with { type: "json" };
import { logger } from "@/utils.js";

const log = logger(import.meta);

/**
 * "Rocket": the game server console for the website.
 *
 * Both games stream their console over their own game websocket: gmod through
 * the addon's gm_enginespew hook, Minecraft through the mod's log appender.
 * Commands run as the server console, attributed to the viewer (see consoleHub).
 *
 * Servers are addressed by "<game>:<id>" since ids are only unique per game.
 */

const MAX_SESSIONS_PER_SERVER = 5;
const MAX_LINES_PER_SECOND = 20;

// gserv verbs the console exposes as buttons, kept to the safe live-update set
const GSERV_ACTIONS = ["rehash", "merge_repos", "rehashskeleton", "update_repos"] as const;

type HostedServer = {
	key: string;
	game: ConsoleGame;
	id: number;
	name: string;
	label?: string;
	gserv: boolean;
};

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
			// the viewer switched away mid-attach: teardown kills the pending
			// connect, which then rejects; a cancellation, not a failure
			if (this.closed) return;
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

/**
 * One console session for either game: the game's own websocket carries the log
 * stream and the commands, so the only per-game difference left is which server
 * list the id belongs to.
 */
class BridgeConsoleSession extends ConsoleSession {
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
		consoleHub.subscribe(this.bridge, this.server.game, this.server.id, this.listener);
		this.send({ type: "ready" });
		if (!this.bridge.servers[this.server.game][this.server.id]?.wsConnection?.connected) {
			this.send({ type: "meta", text: "server not connected, waiting" });
		}
		log.info(`console opened on '${this.server.name}' by ${this.user.login}`);
	}

	protected input(line: string): void {
		// the runner rides with the command; both games print their own
		// "[RCON] <user> ran ..." line, so it shows up in this same stream
		consoleHub
			.command(this.bridge, this.server.game, this.server.id, line, this.user.login)
			.then(sent => {
				if (!sent) this.send({ type: "meta", text: "server not connected" });
			})
			.catch(err => log.warn(err, "console command failed"));
	}

	/** Wired up in part 4, once GservPayload replaces the ssh invocation. */
	protected runGserv(command: unknown): void {
		if (typeof command !== "string" || !GSERV_ACTIONS.includes(command as never)) return;
		this.send({ type: "meta", text: "gserv is unavailable while it is being moved off ssh" });
		this.send({ type: "gserv-done", command, ok: false });
	}

	protected dispose(): void {
		if (this.listener) {
			consoleHub.unsubscribe(this.bridge, this.server.game, this.server.id, this.listener);
		}
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
		if (!isTeamMember(getSession(req))) {
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
		if (!isTeamMember(getSession(req))) {
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
		if (!isTeamMember(session)) {
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
		new BridgeConsoleSession(conn, session, server, bridge()).start();
	});
};
