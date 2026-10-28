import type { SarifLog } from "@microsoft/sarif";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rawLog = readFileSync("eslint-results.sarif", "utf8");
const log: SarifLog = JSON.parse(rawLog);

abstract class Line {
	abstract toString(): string;   
}

class DebugLine extends Line {
	readonly #message: string;

	constructor(message: string) {
		super();
		this.#message = message;
	}

	public toString() {
		return `::debug::${this.#message}`;
	}
}

abstract class FileInfoLine extends Line {
	protected abstract readonly type: string;
	
	readonly #name: string;
	readonly #line: number;
	readonly #endLine: number;
	readonly #title: string;
	readonly #message: string;
	

	constructor(name: string, line: number, endLine: number, title: string, message: string) {
		super();
		this.#name = name;
		this.#line = line;
		this.#endLine = endLine;
		this.#title = title;
		this.#message = message;
	}

	public toString(): string {
		return `::${this.type} file=${this.#name},line=${this.#line},endLine=${this.#endLine},title=${this.#title}::${this.#message}`;
	}
}

class Notice  extends FileInfoLine { protected override type = "notice";  }
class Warning extends FileInfoLine { protected override type = "warning"; }
class Error   extends FileInfoLine { protected override type = "error";   }

// class Group {
// 	#title: string;
// 	readonly #lines: Line[];
//
// 	constructor(title: string, ...lines: Line[]) {
// 		this.#title = title;
// 		this.#lines = lines;
// 	}
//
// 	public toString() {
// 		return [
// 			`::group::${this.#title}`,
// 			...this.#lines,
// 			"::endgroup::",
// 		].join("\n");
// 	}	
// }

const results = log.runs[0].results;

const lines = results.map(result => {
	const location = result.locations[0].physicalLocation;
	const filePath = path.relative(path.dirname(import.meta.dirname), fileURLToPath(location.artifactLocation.uri));

	switch (result.level) {
		case "note":
			return new Notice(filePath, location.region.startLine, location.region.endLine, result.ruleId, result.message.text);
		case "warning":
			return new Warning(filePath, location.region.startLine, location.region.endLine, result.ruleId, result.message.text);
		case "error":
			return new Error(filePath, location.region.startLine, location.region.endLine, result.ruleId, result.message.text);
		default:
			return new DebugLine(JSON.stringify(result));
	}
}).map(line => line.toString());

console.log(lines.join("\n"));
