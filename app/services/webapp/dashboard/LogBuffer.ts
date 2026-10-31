import { EventEmitter } from "node:events";
import { CircularBuffer } from "mnemonist";

export type LogLine = { t: number; stream: "stdout" | "stderr"; line: string };

const CAPACITY = 2000;

function IteratorDrop<T>(iterator: Iterable<T>, count: number) {
	return Iterator.from(iterator).drop(Math.max(0, count || 0));
}

/**
 * Captures everything written to stdout/stderr (pino, console, crash dumps) into
 * a ring buffer and re-emits each line, so the dashboard can stream the process
 * output. Importing this module installs the capture.
 */
class LogBuffer extends EventEmitter<{ line: [LogLine] }> {
	private lines = new CircularBuffer<LogLine>(Array, CAPACITY);
	private partial = { stdout: "", stderr: "" };

	constructor() {
		super();
		this.setMaxListeners(100);
		this.capture("stdout");
		this.capture("stderr");
	}

	/**
	 * Iterates over the most recent entries, oldest first.
	 * @param limit - Maximum number of entries to return; defaults to {@link CAPACITY | buffer capacity}.
	 */
	recent(limit = CAPACITY): IteratorObject<LogLine, void, unknown> {
		if (limit < 1 || Number.isNaN(limit)) return Iterator.from<LogLine>([]);
		return IteratorDrop(this.lines, this.lines.size - Math.trunc(limit));
	}

	push(stream: LogLine["stream"], line: LogLine["line"]): void {
		const entry = { t: Date.now(), stream, line };
		this.lines.push(entry);
		this.emit("line", entry);
	}

	private capture(stream: LogLine["stream"]): void {
		const target = process[stream];
		const original = target.write.bind(target);
		target.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
			try {
				const text =
					typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
				const parts = (this.partial[stream] + text).split(/\r?\n/);
				this.partial[stream] = parts.pop() ?? "";
				for (const line of parts) if (line.length > 0) this.push(stream, line);
			} catch {
				// never let capture break the real write
			}
			return (original as (...args: unknown[]) => boolean)(chunk, ...rest);
		}) as typeof target.write;
	}
}

export const logBuffer = new LogBuffer();
