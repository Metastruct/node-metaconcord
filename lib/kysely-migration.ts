import { FileMigrationProvider, Migrator } from "kysely/migration";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { LocalDatabase } from "#/app/services/SQL.js";

export async function migrateToLatest(db: LocalDatabase) {
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

	if (error)
		throw new Error(`Failed to migrate: ${error instanceof Error ? error.message : error}`);
}
