import { Container } from "../Container";
import { Database, open } from "sqlite";
import { Pool } from "pg";
import { Service } from ".";
import config from "@/config/psql.json";
import sqlite3 from "sqlite3";

const pool = new Pool({
	user: config.user,
	host: config.host,
	database: config.database,
	password: config.password,
});

export class SQL extends Service {
	name = "SQL";

	private database: Database;

	public async getLocalDatabase(): Promise<Database> {
		if (this.database != null) return this.database;

		this.database = await open({
			driver: sqlite3.Database,
			filename: "metaconcord.db",
		});

		return this.database;
	}

	public async queryPool(query: string, values?: unknown[]) {
		return (await pool.query(query, values)).rows;
	}

	public async tableExists(tableName: string): Promise<boolean> {
		const db = await this.getLocalDatabase();
		const result = await db.get(
			"SELECT name FROM sqlite_master WHERE type='table' AND name=?;",
			tableName
		);
		return result != null;
	}
}

export default (container: Container): Service => {
	return new SQL(container);
};
