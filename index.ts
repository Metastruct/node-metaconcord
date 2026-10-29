/* eslint-disable unicorn/no-global-object-property-assignment */

// Load environment variables
import * as dotenv from "dotenv";
dotenv.config();

// Capture process output for the dashboard before anything logs
import "./app/services/webapp/dashboard/LogBuffer.js";
// Other polyfills, prototype extensions etc.
import "#polyfills/Iterator-zip.js";
import "#extensions/index.js";

// Main
import { App } from "./app/index.js";
import { logger } from "./utils.js";

process.on("uncaughtException", err => {
	logger("App").fatal(err as Error);
	process.exit(1);
});

process.on("unhandledRejection", err => {
	logger("App").error(err as Error, "Unhandled rejection, continuing...");
});

// This is sadly required because `vrchat` thinks it's a good idea to register a SIGINT handler:
//     process.on("SIGINT", () => this.close());
// Quote from the Node.js docs: "If one of these signals has a listener installed, its default behavior will be removed. "
// tl;dr: vrchat breaks Ctrl-c at least on windows.
process.on("SIGINT", () => process.exit(1));

const MetaConcord = new App();
globalThis.MetaConcord = MetaConcord;
await MetaConcord.init();

export default MetaConcord;
