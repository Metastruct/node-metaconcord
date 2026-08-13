#!/usr/bin/env node
// Regenerates the request/response JSON schemas in every game's
// handlers/structures/ dir from their .ts source-of-truth types.
//
// One TypeScript program is built per directory (via ts-json-schema-generator's
// programmatic API) and reused for every type in it, instead of shelling out to
// the CLI once per type -- that was the bulk of the old schema_gen.sh's runtime.
import { createGenerator, DEFAULT_CONFIG } from "ts-json-schema-generator";
import stringify from "safe-stable-stringify";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { fileURLToPath } from "url";
import * as prettier from "prettier";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

const structureDirs = [
	"app/services/gamebridge/games/gmod/handlers/structures",
	"app/services/gamebridge/games/minecraft/handlers/structures",
];

for (const relDir of structureDirs) {
	const dir = path.join(rootDir, relDir);
	const typeNames = readdirSync(dir)
		.filter(file => file.endsWith(".ts") && file !== "index.ts")
		.map(file => file.slice(0, -".ts".length));

	// ts-json-schema-generator needs a real ts project to resolve the
	// .js-suffixed imports between structures, so build a throwaway one.
	const scratchDir = mkdtempSync(path.join(tmpdir(), "schema-gen-"));
	const tsconfigPath = path.join(scratchDir, "tsconfig.json");
	writeFileSync(
		tsconfigPath,
		JSON.stringify({
			compilerOptions: {
				target: "ES2022",
				module: "NodeNext",
				moduleResolution: "nodenext",
				strict: true,
				noEmit: true,
			},
			include: [path.join(dir, "*.ts")],
		})
	);

	const generator = createGenerator({
		...DEFAULT_CONFIG,
		path: path.join(dir, "*.ts"),
		tsconfig: tsconfigPath,
	});

	for (const typeName of typeNames) {
		console.log(`Generating schema for ${typeName} (${relDir})`);
		const outPath = path.join(dir, `${typeName}.json`);
		const schema = generator.createSchema(typeName);

		// safe-stable-stringify deep-sorts object keys, matching --unstable-less
		// (i.e. sortProps) CLI output; prettier then applies the project's own
		// json formatting (tabs, collapsed short arrays, ...).
		const prettierConfig = await prettier.resolveConfig(outPath);
		const formatted = await prettier.format(stringify(schema, null, 2), {
			...prettierConfig,
			filepath: outPath,
		});

		writeFileSync(outPath, formatted);
	}

	rmSync(scratchDir, { recursive: true, force: true });
}
