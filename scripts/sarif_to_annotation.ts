import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PhysicalLocation, Result, SarifLog } from "@microsoft/sarif";

// #region Annotation Classes

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

class NoticeLine  extends FileInfoLine { protected override type = "notice";  }
class WarningLine extends FileInfoLine { protected override type = "warning"; }
class ErrorLine   extends FileInfoLine { protected override type = "error";   }

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

// #endregion

// #region Load Sarif

const rawLog = readFileSync("eslint-results.sarif", "utf8");
const log: SarifLog = JSON.parse(rawLog);

type RequiredFields<T, K extends keyof NonNullable<T>> = T & Required<Pick<NonNullable<T>, K>>;

const results = log.runs[0].results;

type CompletePhysicalLocation = PhysicalLocation & {
	artifactLocation: RequiredFields<PhysicalLocation["artifactLocation"], "uri">,
	region: RequiredFields<PhysicalLocation["region"], "startLine" | "endLine">,
};

function isCompletePhysicalLocation(obj?: PhysicalLocation): obj is CompletePhysicalLocation {
	return !!obj && typeof obj.artifactLocation?.uri === "string"
		&& !!obj.region && typeof obj.region.startLine === "number" && typeof obj.region.endLine === "number";
}

type CompleteResult = Result & {
	locations: NonNullable<Result["locations"]>,
	ruleId: NonNullable<Result["ruleId"]>,
	message: RequiredFields<Result["message"], "text">,
};

function isCompleteResult(obj?: Result): obj is CompleteResult {
	return !!obj && Array.isArray(obj.locations)
		&& typeof obj.ruleId === "string"
		&& typeof obj.message.text === "string";
}


if (!Array.isArray(results))
	throw new TypeError("No run in sarif file, or run has no results.");

const lines = results.map(result => {
	if (!isCompleteResult(result))
		throw new TypeError("result is missing required properties");

	const location = result.locations[0].physicalLocation;

	if (!isCompletePhysicalLocation(location))
		throw new TypeError("result.location is missing required properties");

	const filePath = path.relative(path.dirname(import.meta.dirname), fileURLToPath(location.artifactLocation.uri));

	switch (result.level) {
		case "note":
			return new NoticeLine(filePath, location.region.startLine, location.region.endLine, result.ruleId, result.message.text);
		case "warning":
			return new WarningLine(filePath, location.region.startLine, location.region.endLine, result.ruleId, result.message.text);
		case "error":
			return new ErrorLine(filePath, location.region.startLine, location.region.endLine, result.ruleId, result.message.text);
		default:
			return new DebugLine(JSON.stringify(result));
	}
}).map(line => line.toString());

console.log(lines.join("\n"));

// #endregion
