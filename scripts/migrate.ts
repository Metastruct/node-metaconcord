import type { Container } from "#/app/Container.js";
import { migrateToLatest } from "#/lib/kysely-migration.js";
import { LocalDB } from "../app/services/index.js";

const database = (()=>{
	const localDB = new LocalDB({} as Container);
	localDB.init();
	return localDB.db;
})();

await migrateToLatest(database);
