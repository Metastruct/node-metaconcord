import { Container } from "../Container";
import { Database, open } from "sqlite";
import { Service } from ".";
import sqlite3 from "sqlite3";

export class SQL extends Service {
	name = "SQL";

	private database: Database;

	public async getDatabase(): Promise<Database> {
		if (this.database != null) return this.database;

		this.database = await open({
			driver: sqlite3.Database,
			filename: "metaconcord.db",
		});

		return this.database;
	}

	public async tableExists(tableName: string): Promise<boolean> {
		const db = await this.getDatabase();
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
