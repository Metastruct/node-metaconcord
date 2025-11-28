// Load environment variables
import * as dotenv from "dotenv";
dotenv.config();

// console.log(process.version);

// Load module extensions
import "./extensions/index.js";

// Main
import { App } from "./app/index.js";
import { logger } from "./utils.js";
const MetaConcord = new App();
(global as any).MetaConcord = MetaConcord;

process.on("uncaughtException", err => {
	logger("App").fatal(err);
	process.exit(1);
});

export default MetaConcord;
