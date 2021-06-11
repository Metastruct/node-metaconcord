import { Container } from "../Container";
import { Service } from ".";
import sqlite from "sqlite";
import sqlite3 from "sqlite3";

export class Sql extends Service {
	name = "Sql";

	private database: sqlite.Database;

	public async getDatabase(): Promise<sqlite.Database> {
		if (this.database != null) return this.database;

		this.database = await sqlite.open({
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
	return new Sql(container);
};
