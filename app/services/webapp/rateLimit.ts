import { ipKeyGenerator, ValueDeterminingMiddleware } from "express-rate-limit";

export const rateLimitKeyGenerator: ValueDeterminingMiddleware<string> = req => {
	const cfConnectingIp = req.headers["cf-connecting-ip"];
	if (typeof cfConnectingIp === "string")
		return ipKeyGenerator(cfConnectingIp);
	if (Array.isArray(cfConnectingIp) && cfConnectingIp.length > 0)
		return ipKeyGenerator(cfConnectingIp[0]);
	if (req.ip)
		return ipKeyGenerator(req.ip);
	if (req.socket.remoteAddress)
		return ipKeyGenerator(req.socket.remoteAddress);
	return "unknown";
};
