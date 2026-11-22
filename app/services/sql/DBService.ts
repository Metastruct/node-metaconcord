import type { Kysely } from "kysely";

import { Service } from "../../Service.ts";

/**
 * Base service exposing a schema-typed Kysely database instance.
 * @typeParam T - Database schema mapping table names to their row types.
 */
export abstract class DBService<T> extends Service {
	abstract get db(): Kysely<T>;
}
