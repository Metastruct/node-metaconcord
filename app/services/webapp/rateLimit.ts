import type { Request } from "express";

export const rateLimitKeyGenerator = (req: Request): string =>
	req.headers["cf-connecting-ip"]?.toString() ?? req.ip ?? req.socket.remoteAddress ?? "unknown";
