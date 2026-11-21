import path from "node:path";
import pino from "pino";

// debug so access logs reach the dashboard buffer, its UI defaults to info+
export const baseLogger = pino({ level: process.env.LOG_LEVEL || "debug" });

export const logger = (meta: ImportMeta | string) =>
	baseLogger.child({ file: typeof meta === "string" ? meta : path.basename(meta.filename) });
