// Load environment variables
import * as dotenv from "dotenv";
dotenv.config();

// Main
import { App } from "./app";
const MetaConcord = new App();
(global as any).MetaConcord = MetaConcord;

export default MetaConcord;
