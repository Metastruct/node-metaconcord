import SQLite from "better-sqlite3";
import { Kysely, SqliteDialect } from "kysely";

import { migrateToLatest } from "#lib/kyselyMigrator";
import { logger } from "#utils";
import { DBService } from "#/app/services/sql/DBService.js";
import { type DB } from "#/generated/LocalDBTypes.js";
import { type Container, type Service } from "../../Container.js";

const log = logger(import.meta);

const OPTIMIZE_INTERVAL_MS = Temporal.Duration.from({ hours: 24 }).total("milliseconds");

let sqlite: SQLite.Database;

/** Gets the _one_ SQLite instance. */
function getSQLite() {
	if (sqlite)
		return sqlite;
	sqlite = new SQLite(process.env.METACONCORD_DB_PATH ?? "metaconcord.db");
	sqlite.pragma("journal_mode = WAL");
	sqlite.pragma("busy_timeout = 5000");
	sqlite.pragma("recursive_triggers = on");
	sqlite.pragma("foreign_keys = on");
	sqlite.pragma("optimize = 0x10002");
	return sqlite;
}

export type LocalDatabase = Kysely<DB>;
let sqliteKysely: Kysely<DB>;

/** Gets the _one_ Kysely object. */
function getSQLiteKysely() {
	if (sqliteKysely)
		return sqliteKysely;

	const dialect = new SqliteDialect({
		database: getSQLite(),
	});

	sqliteKysely = new Kysely<DB>({
		dialect,
		//log: ["query", "error"],
		log(event) {
			if (event.level === "error") {
				log.error("Query failed (%d ms): %s\n%s %s",
					Math.trunc(event.queryDurationMillis*10)/10, event.error, event.query.sql, event.query.parameters);
				console.error("QUERY FAILED :", {
					error: event.error,
					sql: event.query.sql,
					params: event.query.parameters,
					durationMs: event.queryDurationMillis,
				});
			} else { // `'query'`
				//console.log("Query executed (%d ms): %s %s", Math.trunc(event.queryDurationMillis*10)/10, event.query.sql, event.query.parameters);
			}
		},
	});

	return sqliteKysely;
}


export class LocalDB extends DBService<DB> {
	override name = "LocalDB";
	#sqliteDatabase?: SQLite.Database;
	#localDB?: Kysely<DB>;
	#optimizeTimer?: ReturnType<typeof setInterval>;

	initBackend() {
		this.#sqliteDatabase = getSQLite();
		this.#localDB = getSQLiteKysely();
	}

	override async init() {
		this.initBackend();
		await migrateToLatest(this.db);
	}

	override async start() {
		if (this.#optimizeTimer) return;
		this.#optimizeTimer = setInterval(() => this.#optimize(), OPTIMIZE_INTERVAL_MS);
		this.#optimizeTimer.unref();
	}

	#optimize() {
		this.#sqliteDatabase?.pragma("optimize");
	}

	/** @deprecated Do not rely on this anymore, access the database using Kysely via the `.db` property. */
	getLocalDatabase() {
		if (!this.#sqliteDatabase) throw new Error("LocalDB has not been initialized");
		return this.#sqliteDatabase;
	}

	public tableExists(tableName: string): boolean {
		if (!this.#sqliteDatabase) throw new Error("LocalDB has not been initialized");
		const result = this.#sqliteDatabase
			.prepare<string, { name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name=? LIMIT 1;")
			.get(tableName);

		return Boolean(result);
	}

	public get db() {
		if (!this.#localDB) throw new Error("LocalDB has not been initialized");
		return this.#localDB;
	}

	public static get db() {
		return getSQLiteKysely();
	}
}

export default function LocalDBProvider(container: Container): Service {
	return new LocalDB(container);
}
