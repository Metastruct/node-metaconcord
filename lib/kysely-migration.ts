import { FileMigrationProvider, Migrator } from "kysely/migration";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { LocalDatabase } from "#/app/services/sql/LocalDB.js";
import pino from "pino";

const log = pino({ level: "debug" }).child({file: path.basename(import.meta.filename)});

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

	const migrations = await migrator.getMigrations();
	const countTotal = migrations.length;
	const countPre = migrations.filter(m => m.executedAt).length;

	const { error, results } = await migrator.migrateToLatest();

	const countApplied = results.length;

	for (const [i, result] of results.entries()) {
		if (result.status === "Success") {
			log.info(`applied migration #${i+1} of ${countApplied}: ${result.migrationName}`);
		} else if (result.status === "Error") {
			log.error(`failed to apply migration ${result.migrationName}`);
		}
	}

	if (results?.length > 0) {
		log.info(`applied ${countApplied} new migration${countApplied === 1 ? "" : "s"}, now at ${countPre+countApplied}/${countTotal}`);
	} else if (results?.length === 0) {
		log.debug(`database schema is up-to-date (${countPre}/${countTotal})`);
	}

	if (error)
		throw new Error(`Failed to migrate: ${error instanceof Error ? error.message : error}`);
}
