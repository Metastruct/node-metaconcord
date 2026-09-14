import WebAppConfig from "@/config/webapp.json" with { type: "json" };
import crypto from "crypto";

/** AES-GCM with a key derived from cookieSecret: session cookies and stored provider tokens. */

// signed cookies are readable by the browser, encrypted ones are not
const key = crypto.createHash("sha256").update(WebAppConfig.cookieSecret).digest();

export const encrypt = (data: unknown): string => {
	const iv = crypto.randomBytes(12);
	const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
	const body = Buffer.concat([cipher.update(JSON.stringify(data), "utf8"), cipher.final()]);
	return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
};

export const decrypt = <T>(value: string): T | undefined => {
	try {
		const buf = Buffer.from(value, "base64url");
		const decipher = crypto.createDecipheriv("aes-256-gcm", key, buf.subarray(0, 12));
		decipher.setAuthTag(buf.subarray(12, 28));
		const body = Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]);
		return JSON.parse(body.toString("utf8")) as T;
	} catch {
		return undefined;
	}
};
