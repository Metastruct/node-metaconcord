import { Container, Service } from "../Container.js";
import BetterSqlite3 from "better-sqlite3";
import { Pool } from "pg";
import config from "#/config/psql.json" with { type: "json" };

const pool = new Pool({
	user: config.user,
	host: config.host,
	database: config.database,
	password: config.password,
});

export type LocalDatabase = BetterSqlite3.Database;
export type LocalBindParameters = unknown[];
export type LocalRow = BetterSqlite3.RunResult;

export class SQL extends Service {
	override name = "SQL";
	database!: LocalDatabase;

	override async init(): Promise<void> {
		this.database = new BetterSqlite3(process.env.METACONCORD_DB_PATH ?? "metaconcord.db");
		this.database.pragma("journal_mode = WAL");
		this.database.pragma("busy_timeout = 5000");
	}

	getLocalDatabase(): LocalDatabase {
		return this.database;
	}

	execLocal(sql: string): void {
		this.database.exec(sql);
	}

	getLocal<T>(query: string, ...params: LocalBindParameters): T | undefined {
		return this.database.prepare(query).get(...params) as T | undefined;
	}

	allLocal<T>(query: string, ...params: LocalBindParameters): T[] {
		return this.database.prepare(query).all(...params) as T[];
	}

	runLocal(query: string, ...params: LocalBindParameters): LocalRow {
		return this.database.prepare(query).run(...params);
	}

	public async queryPool(query: string, values?: unknown[]) {
		return (await pool.query(query, values)).rows;
	}

	public tableExists(tableName: string): boolean {
		const result = this.getLocal<{ name: string }>(
			"SELECT name FROM sqlite_master WHERE type='table' AND name=?;",
			tableName
		);
		return result != null;
	}
}

export default (container: Container): Service => {
	return new SQL(container);
};
