import { NodeSSH } from "node-ssh";
import GameBridge from "../../GameBridge.js";
import { GmodConnectionConfig } from "./GmodConnection.js";
import sshConfig from "@/config/ssh.json" with { type: "json" };
import { logger } from "@/utils.js";

const log = logger(import.meta);

const INTERVAL_MS = 5000;
const MAX_BACKOFF_MS = 5 * 60 * 1000;
/** pgrep -f pattern for the srcds process on the host, scoped to the ssh user */
const SRCDS_PATTERN = "srcds_linux";

// one round-trip per sample: srcds cpu ticks + rss, host memory and interface counters
const PROBE_COMMAND = [
	`pid=$(pgrep -u "$USER" -f ${SRCDS_PATTERN} | head -n1)`,
	'echo "pid $pid"',
	'echo "clk $(getconf CLK_TCK)"',
	'[ -n "$pid" ] && echo "cpu $(sed "s/.*) //" /proc/$pid/stat | awk \'{print $12, $13}\')"',
	'[ -n "$pid" ] && echo "rss $(awk \'/VmRSS/{print $2}\' /proc/$pid/status)"',
	"echo \"memtotal $(awk '/MemTotal/{print $2}' /proc/meminfo)\"",
	`echo "net $(awk -F'[: ]+' 'NR>2 && $2!="lo"{rx+=$3;tx+=$11} END{print rx+0, tx+0}' /proc/net/dev)"`,
	"true",
].join("; ");

// fps and players, same lua round-trip the old status route used
const STATUS_LUA =
	"return util.TableToJSON({fps=math.floor(1/FrameTime()),players=player.GetCount(),max=game.MaxPlayers()})";

type Counters = { t: number; cpuTicks: number; rx: number; tx: number };

export const sshConnectOptions = (ssh: NonNullable<GmodConnectionConfig["ssh"]>) => ({
	host: ssh.host,
	port: ssh.port,
	username: ssh.username,
	// ssh.json keyPath, or the ssh agent when it is empty (local dev)
	...(sshConfig.keyPath
		? { privateKeyPath: sshConfig.keyPath }
		: { agent: process.env.SSH_AUTH_SOCK }),
});

/**
 * Samples the srcds process of a hosted gmod server over one long-lived ssh
 * connection every 5s and feeds the bridge's stats history, so the rocket
 * page has a graph to show the moment it opens. Runs for the lifetime of the
 * process, independently of the gmod websocket.
 */
export default class GmodStatsProbe {
	private ssh?: NodeSSH;
	private previous?: Counters;
	private failures = 0;
	private timer?: NodeJS.Timeout;
	private stopped = false;
	/** max players from the last successful lua round-trip */
	maxPlayers?: number;

	constructor(
		private bridge: GameBridge,
		private config: GmodConnectionConfig
	) {}

	start(): void {
		this.schedule(0);
	}

	stop(): void {
		this.stopped = true;
		clearTimeout(this.timer);
		this.ssh?.dispose();
	}

	private schedule(delay: number): void {
		if (this.stopped) return;
		clearTimeout(this.timer);
		this.timer = setTimeout(() => this.tick(), delay);
	}

	private async tick(): Promise<void> {
		try {
			await this.sample();
			this.failures = 0;
			this.schedule(INTERVAL_MS);
		} catch (err) {
			this.failures++;
			this.ssh?.dispose();
			this.ssh = undefined;
			this.previous = undefined;
			const delay = Math.min(INTERVAL_MS * 2 ** this.failures, MAX_BACKOFF_MS);
			log.warn({ err, server: this.config.name, delay }, "stats probe failed");
			this.schedule(delay);
		}
	}

	private async connection(): Promise<NodeSSH> {
		if (this.ssh?.isConnected()) return this.ssh;
		if (!this.config.ssh) throw new Error("server has no ssh config");
		this.ssh = new NodeSSH();
		await this.ssh.connect(sshConnectOptions(this.config.ssh));
		return this.ssh;
	}

	private async sample(): Promise<void> {
		const ssh = await this.connection();
		const result = await ssh.execCommand(PROBE_COMMAND);
		const fields = new Map<string, string[]>();
		for (const line of result.stdout.split("\n")) {
			const [key, ...values] = line.trim().split(/\s+/);
			if (key) fields.set(key, values);
		}
		const num = (key: string, index = 0) => Number(fields.get(key)?.[index] ?? NaN);
		const clk = num("clk") || 100;
		const pid = num("pid");
		const now: Counters = {
			t: Date.now(),
			cpuTicks: pid ? num("cpu", 0) + num("cpu", 1) : 0,
			rx: num("net", 0),
			tx: num("net", 1),
		};

		let cpu = 0;
		let netRx = 0;
		let netTx = 0;
		if (this.previous && now.t > this.previous.t) {
			const dt = (now.t - this.previous.t) / 1000;
			if (pid && now.cpuTicks >= this.previous.cpuTicks) {
				cpu = ((now.cpuTicks - this.previous.cpuTicks) / clk / dt) * 100;
			}
			netRx = Math.max(0, (now.rx - this.previous.rx) / dt);
			netTx = Math.max(0, (now.tx - this.previous.tx) / dt);
		}
		this.previous = now;

		const live = await this.liveStatus();
		this.bridge.statsFor("gmod", this.config.id).push({
			t: now.t,
			cpu: Math.round(cpu * 10) / 10,
			memUsed: pid ? num("rss") * 1024 : 0,
			memMax: num("memtotal") * 1024,
			netRx: Math.round(netRx),
			netTx: Math.round(netTx),
			tick: live?.fps,
			players: live?.players,
		});
	}

	private async liveStatus(): Promise<{ fps?: number; players?: number } | undefined> {
		const server = this.bridge.servers.gmod[this.config.id];
		if (!server?.wsConnection?.connected) return;
		try {
			const result = await server.sendLua(STATUS_LUA);
			const parsed = JSON.parse(result?.data.returns?.[0] ?? "{}");
			if (typeof parsed.max === "number") this.maxPlayers = parsed.max;
			return { fps: parsed.fps, players: parsed.players };
		} catch {
			return;
		}
	}
}
