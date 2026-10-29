import type { Container } from "#/app/Container.js";
import { SQL } from "#/app/services/SQL.js";
import { migrateToLatest } from "#/lib/kysely-migration.js";

const localDB = (()=>{
	const sql = new SQL({} as Container);
	sql.init();
	return sql.localDB;
})();

await migrateToLatest(localDB);
