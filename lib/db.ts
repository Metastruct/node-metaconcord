//import { Database } from "./types.ts";
import SQLite from "better-sqlite3";
import { Kysely, SqliteDialect } from "kysely";

const dialect = new SqliteDialect({
	database: new SQLite(process.env.METACONCORD_DB_PATH ?? "metaconcord.db"),
});

export const db = new Kysely<any>({
	dialect,
});
