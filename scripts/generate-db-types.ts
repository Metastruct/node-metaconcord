import { KyselyTypegenSQLiteDialect } from "kysely-typegen/sqlite";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import SQLite from "better-sqlite3";
import { Kysely, SqliteDialect } from "kysely";
import { fileURLToPath } from "node:url";
import { migrateToLatest } from "#kysely-migration";

// Create an in-memory SQLite db.

const sqlite = SQLite(":memory:");
sqlite.defaultSafeIntegers();
const dialect = new SqliteDialect({ database: sqlite });
const database = new Kysely<any>({ dialect });

// Set up kysely-typegen.

class KyselyTypegenSQLiteWithBigIntsDialect extends KyselyTypegenSQLiteDialect {
	constructor(...args: ConstructorParameters<typeof KyselyTypegenSQLiteDialect>) {
		super(...args);
		Object.assign(this.scalars, {
			BIGINT: "bigint",
			INTEGER: "bigint",
		});
	}
}

const databaseTypegen = new KyselyTypegenSQLiteWithBigIntsDialect({ database });

// Run migrations on in-memory db.

await migrateToLatest(database);

// Generate the types.

const result = await databaseTypegen.typegen();

const output = result.lines.join("\n");
const outputPath = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), "generated", "LocalDBTypes.ts");

// Write to file.

if (!existsSync(path.dirname(outputPath)))
	mkdirSync(path.dirname(outputPath));
writeFileSync(outputPath, output, "utf8");

console.log(`Generated local DB types at ${outputPath}.`);

// Cleanup.
await database.destroy();
