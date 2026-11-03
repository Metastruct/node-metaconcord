import { type Kysely, type Transaction } from "kysely";

/* eslint-disable @typescript-eslint/no-explicit-any */

type DBMigrationFunction = (db: Kysely<any>) => Promise<void>;
type TxMigrationFunction = (db: Transaction<any>) => Promise<void>;

interface DBMigration {
	up: DBMigrationFunction,
	down: DBMigrationFunction
}

interface TxMigration {
	up: TxMigrationFunction,
	down: TxMigrationFunction
}

export function defineSQLiteMigration(migration: TxMigration): DBMigration {
	return {
		up: db => db.transaction().execute(migration.up),
		down: db => db.transaction().execute(migration.down),
	};
}
