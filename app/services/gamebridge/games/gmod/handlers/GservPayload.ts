import { GservRequest, GservResponse } from "./structures/index.js";
import GmodConnection from "../GmodConnection.js";
import Payload from "./Payload.js";
import requestSchema from "./structures/GservRequest.json" with { type: "json" };
import responseSchema from "./structures/GservResponse.json" with { type: "json" };

/** How long a run may stay silent before it is given up on. */
const TIMEOUT = 15 * 60 * 1000;

export type GservResult = { ok: boolean; code?: number; output: string; error?: string };

type Run = {
	onChunk?: (chunk: string) => void;
	lines: string[];
	settle: (result: GservResult) => void;
	timer: NodeJS.Timeout;
};

/**
 * Runs a gserv verb on the game host. Replaces the ssh invocation; the verb is
 * validated against a whitelist inside the addon's native module, so anything
 * unexpected comes back as an error rather than running.
 */
export default class GservPayload extends Payload {
	protected static requestSchema = requestSchema;
	protected static responseSchema = responseSchema;

	private static nextId = 0;
	private static runs = new Map<string, Run>();

	static async send(payload: GservResponse, server: GmodConnection): Promise<void> {
		super.send(payload, server);
	}

	static async handle(payload: GservRequest, server: GmodConnection): Promise<void> {
		super.handle(payload, server);

		const { identifier, kind, data, done, code, error } = payload.data;
		const run = this.runs.get(identifier);
		if (!run) return;

		if (!done) {
			if (typeof data === "string") {
				run.lines.push(data);
				run.onChunk?.(data + "\n");
			}
			// a chatty verb keeps its own timeout alive
			run.timer.refresh();
			return;
		}

		this.runs.delete(identifier);
		clearTimeout(run.timer);

		const output = run.lines.join("\n");
		// srcds ignores SIGCHLD, so its auto-reap can take gserv's status before
		// the module reads it. The run still happened, so judge it by its output
		// the way the ssh path did.
		const exited = code === undefined || code === 0;
		run.settle({
			// gserv reports its own failures in the output, whatever it exits with
			ok: !error && exited && !output.includes("GSERV FAILED"),
			code,
			output,
			error,
		});
		void kind;
	}

	/** Resolves when the run finishes; never rejects, failures come back in the result. */
	static async run(
		command: string,
		server: GmodConnection,
		onChunk?: (chunk: string) => void
	): Promise<GservResult> {
		if (!server.wsConnection?.connected) {
			return { ok: false, output: "", error: "server not connected" };
		}

		const identifier = (this.nextId++).toString();
		const result = new Promise<GservResult>(resolve => {
			this.runs.set(identifier, {
				onChunk,
				lines: [],
				settle: resolve,
				timer: setTimeout(() => {
					this.runs.delete(identifier);
					resolve({ ok: false, output: "", error: "gserv timed out" });
				}, TIMEOUT),
			});
		});

		await this.send({ command, identifier }, server);
		return result;
	}
}
