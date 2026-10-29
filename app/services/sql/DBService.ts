import { Kysely } from "kysely";
import { Service } from "../../Container.js";

/**
 * Base service exposing a schema-typed Kysely database instance.
 * @typeParam T - Database schema mapping table names to their row types.
 */
export abstract class DBService<T> extends Service {
	abstract override name: string;
	abstract get db(): Kysely<T>;
}
