import config from "#/config/psql.json" with { type: "json" };
import { Pool } from "pg";
import SQLite from "better-sqlite3";
import { Container, Service } from "../Container.js";
import { Kysely, SqliteDialect } from "kysely";
import { DB } from "#/generated/LocalDBTypes.js";

const pool = new Pool({
	user: config.user,
	host: config.host,
	database: config.database,
	password: config.password,
});

let sqlite: SQLite.Database;

/** Gets the _one_ SQLite instance. */
function getSQLite() {
	if (sqlite)
		return sqlite;
	sqlite = new SQLite(process.env.METACONCORD_DB_PATH ?? "metaconcord.db");
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


export class SQL extends Service {
	override name = "SQL";
	#sqliteDatabase: SQLite.Database;
	#localDB: Kysely<DB>;

	override async init(): Promise<void> {
		this.#sqliteDatabase = getSQLite();
		this.#localDB = getSQLiteKysely();
	}

	getLocalDatabase() {
		return this.#sqliteDatabase;
	}

	public tableExists(tableName: string): boolean {
		const result = this.#sqliteDatabase
			.prepare<string, { name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name=? LIMIT 1;")
			.get(tableName);

		return Boolean(result);
	}

	public async queryPool(query: string, values?: unknown[]) {
		return (await pool.query(query, values)).rows;
	}

	public get localDB(): LocalDatabase {
		return this.#localDB;
	}
}

export default function SQLProvider(container: Container): Service {
	return new SQL(container);
}
