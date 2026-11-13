import { type Kysely, sql, type Transaction } from "kysely";

/* eslint-disable @typescript-eslint/no-explicit-any */

type DBMigrationFunction = (db: Kysely<any>) => Promise<void>;
type TxMigrationFunction = (db: Transaction<any>) => Promise<void>;

interface DBMigration {
	/** The upgrade function passed to the Kysely migrator. Export this. */
	up: DBMigrationFunction,
	/** The downgrade function passed to the Kysely migrator. Export this. */
	down: DBMigrationFunction
}

interface TxMigration {
	/** The upgrade function which is wrapped in a transaction. */
	up: TxMigrationFunction,
	/** The downgrade function which is wrapped in a transaction. */
	down: TxMigrationFunction
}

/**
 * Helper to wrap SQLite schema migrations in transactions.
 *
 * Instead of writing up/down functions that take a {@link Kysely<any>} object,
 * this helper starts a transaction and calls the passed up/down functions with a {@link Transaction<any>} object.
 * Errors that occur cause the transaction to be rolled back automatically, ensuring the migration is not partially applied.
 *
 * #### Usage:
 * ```ts
 * export const { up, down } = defineSQLiteMigration({
 *   async up(tx) {
 *     await db.schema.(...)
 *   },
 *   async down(tx) {
 *     await db.schema.(...)
 *   }
 * });
 * ```
 */
export function defineSQLiteMigration(migration: TxMigration): DBMigration {
	return {
		up: db => db.transaction().execute(migration.up),
		down: db => db.transaction().execute(migration.down),
	};
}

export const NOW_MS = sql<number>`(cast(unixepoch('subsec') * 1000 as integer))`;
