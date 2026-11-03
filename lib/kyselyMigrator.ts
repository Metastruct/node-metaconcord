import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { FileMigrationProvider, Migrator } from "kysely/migration";
import pino from "pino";

import type { LocalDatabase } from "#/app/services/sql/LocalDB.js";

type Logger = Pick<Console, "info" | "error" | "debug">;
const defaultLog = pino({ level: "debug" }).child({ file: path.basename(import.meta.filename) });

type MigrationDirection = "latest" | "up" | "down";

const verb = {
	latest: "apply",
	up: "apply",
	down: "roll back",
} as const satisfies Record<MigrationDirection, string>;

const completedVerb = {
	latest: "applied",
	up: "applied",
	down: "rolled back",
} as const satisfies Record<MigrationDirection, string>;

const migrationFolder = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), "migrations");

export const provider = new FileMigrationProvider({
	fs,
	path,
	import: (filePath: string) => import(pathToFileURL(filePath).href),
	migrationFolder,
});

export async function migrate(direction: MigrationDirection, db: LocalDatabase, log: Logger = defaultLog) {
	const migrator = new Migrator({
		db,
		provider,
	});

	const migrations = await migrator.getMigrations();
	const countTotal = migrations.length;
	const countPre = migrations.filter(m => m.executedAt).length;

	const operations = {
		latest: () => migrator.migrateToLatest(),
		up: () => migrator.migrateUp(),
		down: () => migrator.migrateDown(),
	};
	const { error, results } = await operations[direction]();

	if (error)
		throw new Error(`Failed to migrate ${direction}: ${error instanceof Error ? error.message : error}`, { cause: error });
	if (!results)
		throw new Error(`Failed to migrate ${direction}: results is ${results}`);

	const countApplied = results.length;
	const countPost = countPre + (direction === "down" ? -countApplied : countApplied);

	for (const [i, result] of results.entries()) {
		if (result.status === "Success") {
			log.info(`${completedVerb[direction]} migration #${i+1} of ${countApplied}: ${result.migrationName}`);
		} else if (result.status === "Error") {
			log.error(`failed to ${verb[direction]} migration ${result.migrationName}`);
		}
	}

	if (results.length > 0) {
		log.info(`${completedVerb[direction]} ${countApplied} migration${countApplied === 1 ? "" : "s"}, now at ${countPost}/${countTotal}`);
	} else if (direction === "down") {
		log.debug(`no migrations to roll back (${countPre}/${countTotal})`);
	} else {
		log.debug(`database schema is up-to-date (${countPre}/${countTotal})`);
	}
}

export const migrateToLatest = migrate.bind(undefined, "latest");
export const migrateUp = migrate.bind(undefined, "up");
export const migrateDown = migrate.bind(undefined, "down");
