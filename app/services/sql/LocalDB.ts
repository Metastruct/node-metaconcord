import SQLite from "better-sqlite3";
import { Kysely, SqliteDialect } from "kysely";

import { DBService } from "#/app/services/sql/DBService.js";
import { type DB } from "#/generated/LocalDBTypes.js";
import { migrateToLatest } from "#/lib/kysely-migration.js";
import { type Container, type Service } from "../../Container.js";

let sqlite: SQLite.Database;

/** Gets the _one_ SQLite instance. */
function getSQLite() {
	if (sqlite)
		return sqlite;
	sqlite = new SQLite(process.env.METACONCORD_DB_PATH ?? "metaconcord.db");
	sqlite.defaultSafeIntegers();
	sqlite.pragma("journal_mode = WAL");
	sqlite.pragma("busy_timeout = 5000");
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
	});

	return sqliteKysely;
}


export class LocalDB extends DBService<DB> {
	override name = "LocalDB";
	#sqliteDatabase: SQLite.Database;
	#localDB: Kysely<DB>;

	initBackend() {
		this.#sqliteDatabase = getSQLite();
		this.#localDB = getSQLiteKysely();
	}

	override async init() {
		this.initBackend();
		await migrateToLatest(this.#localDB);
	}

	/** @deprecated Do not rely on this anymore, access the database using Kysely via the `.db` property. */
	getLocalDatabase() {
		return this.#sqliteDatabase;
	}

	public tableExists(tableName: string): boolean {
		const result = this.#sqliteDatabase
			.prepare<string, { name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name=? LIMIT 1;")
			.get(tableName);

		return Boolean(result);
	}

	public get db() {
		return this.#localDB;
	}
}

export default function LocalDBProvider(container: Container): Service {
	return new LocalDB(container);
}
