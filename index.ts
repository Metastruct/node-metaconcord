// Load environment variables
import * as dotenv from "dotenv";
dotenv.config();

// console.log(process.version);

// Load module extensions
import "./extensions/index.js";

// Main
import { App } from "./app/index.js";
import { logger } from "./utils.js";

process.on("uncaughtException", err => {
	logger("App").fatal(err as Error);
	process.exit(1);
});

process.on("unhandledRejection", err => {
	logger("App").fatal(err as Error);
	process.exit(1);
});

const MetaConcord = new App();
(global as any).MetaConcord = MetaConcord;
await MetaConcord.init();

export default MetaConcord;
