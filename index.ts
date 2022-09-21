// Load environment variables
import * as dotenv from "dotenv";
dotenv.config();

// console.log(process.version);

// Load module extensions
import "@/extensions";

// Main
import { App } from "./app";
const MetaConcord = new App();
(global as any).MetaConcord = MetaConcord;

export default MetaConcord;
