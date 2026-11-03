import { migrate } from "#lib/kyselyMigrator";
import { LocalDB } from "#/app/services/index.js";

const direction = (["latest", "up", "down"] as const).find(mode => mode === (process.argv[2] ?? "latest"));
if (!direction)
	throw new Error("Usage: scripts/migrate.ts [latest|up|down]");

await migrate(direction, LocalDB.db);
