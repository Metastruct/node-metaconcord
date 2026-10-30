import config from "#/config/psql.json" with {type: "json"};
import { Pool } from "pg";
import { Container, Service } from "../../Container.js";
import { DBService } from "#/app/services/sql/DBService.js";

let pool: Pool;

/** Gets the _one_ pg Pool instance. */
function getPool() {
	if (pool)
		return pool;
	pool = new Pool({
		user: config.user,
		host: config.host,
		database: config.database,
		password: config.password,
	});
	return pool;
}

export class RemoteDB extends DBService<never> {
	override name = "RemoteDB";
	#pool: Pool;

	override async init(): Promise<void> {
		this.#pool = getPool();
	}

	public async query(query: string, values?: unknown[]) {
		return (await this.#pool.query(query, values)).rows;
	}

	override get db(): never {
		throw new Error("Method not yet implemented.");
	}
}

export default function RemoteDBProvider(container: Container): Service {
	return new RemoteDB(container);
}
