import * as path from "node:path";
import { promises as fs } from "node:fs";
import { FileMigrationProvider, Migrator } from "kysely/migration";
import { fileURLToPath, pathToFileURL } from "node:url";
import { db } from "#/lib/db.js";

async function migrateToLatest() {
	const migrationFolder = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), "migrations");

	const migrator = new Migrator({
		db,
		provider: new FileMigrationProvider({
			fs,
			path,
			import: (filePath: string) => import(pathToFileURL(filePath).href),
			migrationFolder,
		}),
	});

	const { error, results } = await migrator.migrateToLatest();

	results?.forEach((it) => {
		if (it.status === "Success") {
			console.log(`migration "${it.migrationName}" was executed successfully`);
		} else if (it.status === "Error") {
			console.error(`failed to execute migration "${it.migrationName}"`);
		}
	});

	if (error) {
		console.error("failed to migrate");
		console.error(error);
		// eslint-disable-next-line unicorn/no-process-exit
		process.exit(1);
	}

	await db.destroy();
}

await migrateToLatest();
