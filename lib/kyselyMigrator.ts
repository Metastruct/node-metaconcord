import { constants, copyFileSync, mkdirSync, promises as promisesFs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { FileMigrationProvider, Migrator } from "kysely/migration";

import { logger } from "#lib/logger";
import type { LocalDatabase } from "#/app/services/sql/LocalDB.ts";

type Logger = Pick<Console, "info" | "error" | "debug">;
const defaultLog = logger(path.basename(import.meta.filename));

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

const migrationFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../migrations");

export const provider = new FileMigrationProvider({
	fs: promisesFs,
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

const RGX_MIGRATIONNAME = /^[a-zA-Z0-9][a-zA-Z0-9_-]*[a-zA-Z0-9]$/;

export function makeMigration(name?: string, projectRoot = process.cwd()): string {
	if (!name)
		throw new Error("Missing migration name.");

	name = name.trim().replaceAll(/\s+/g, "_");

	if (!RGX_MIGRATIONNAME.test(name))
		throw new Error("Migration name must start with a letter or number and contain only letters, numbers, underscores, or hyphens.");

	const date = new Date().toISOString().slice(0, 10);
	const filename = `${date}_${name}.ts`;

	const templatePath = path.join(projectRoot, "resources", "migration-templates", "migration.ts");
	const destinationPath = path.join(migrationFolder, filename);

	mkdirSync(migrationFolder, { recursive: true });

	copyFileSync(
		templatePath,
		destinationPath,
		constants.COPYFILE_EXCL,
	);

	return destinationPath;
}
