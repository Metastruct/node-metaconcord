import { EventEmitter } from "events";

export type LogLine = { t: number; stream: "stdout" | "stderr"; line: string };

const CAPACITY = 2000;

/**
 * Captures everything written to stdout/stderr (pino, console, crash dumps) into
 * a ring buffer and re-emits each line, so the dashboard can stream the process
 * output. Importing this module installs the capture.
 */
class LogBuffer extends EventEmitter<{ line: [LogLine] }> {
	private lines: LogLine[] = [];
	private partial = { stdout: "", stderr: "" };

	constructor() {
		super();
		this.setMaxListeners(100);
		this.capture("stdout");
		this.capture("stderr");
	}

	recent(limit = CAPACITY): LogLine[] {
		return this.lines.slice(-limit);
	}

	push(stream: LogLine["stream"], line: string): void {
		const entry = { t: Date.now(), stream, line };
		this.lines.push(entry);
		if (this.lines.length > CAPACITY) this.lines.splice(0, this.lines.length - CAPACITY);
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
				for (const line of parts) if (line.length) this.push(stream, line);
			} catch {
				// never let capture break the real write
			}
			return (original as (...args: unknown[]) => boolean)(chunk, ...rest);
		}) as typeof target.write;
	}
}

export const logBuffer = new LogBuffer();
