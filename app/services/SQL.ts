import { Container, Service } from "../Container.js";
import { Database, open } from "sqlite";
import { Pool } from "pg";
import config from "@/config/psql.json" with { type: "json" };
import sqlite3 from "sqlite3";

const pool = new Pool({
	user: config.user,
	host: config.host,
	database: config.database,
	password: config.password,
});

export class SQL extends Service {
	name = "SQL";
	database!: Database;

	async init(): Promise<void> {
		this.database = await open({
			driver: sqlite3.Database,
			filename: "metaconcord.db",
		});

		await this.database.exec("PRAGMA journal_mode=WAL;");
		await this.database.exec("PRAGMA busy_timeout=5000;");
	}

	getLocalDatabase(): Database {
		return this.database;
	}

	public async queryPool(query: string, values?: unknown[]) {
		return (await pool.query(query, values)).rows;
	}

	public async tableExists(tableName: string): Promise<boolean> {
		const result = await this.database.get(
			"SELECT name FROM sqlite_master WHERE type='table' AND name=?;",
			tableName
		);
		return result != null;
	}
}

export default (container: Container): Service => {
	return new SQL(container);
};
