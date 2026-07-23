import axios from "axios";
import jwt from "jsonwebtoken";
import config from "@/config/ss13.json" with { type: "json" };

const USER_AGENT = "node-metaconcord";

export enum WatchdogStatus {
	Offline = 0,
	Restoring = 1,
	Online = 2,
	DelayedRestart = 3,
}

export type DreamDaemonResponse = {
	status: WatchdogStatus | null;
	clientCount: number | null;
	launchTime: string | null;
	currentPort: number | null;
	activeCompileJob: {
		revisionInformation?: {
			commitSha?: string;
		};
	} | null;
};

let apiVersion: string | undefined;
let token: string | undefined;
let tokenExpiresAt = 0;

// TGS requires the Api header on every request, including this discovery
// call - there's no way to know the real version before asking. Send a
// guess; if TGS rejects it, it reports its actual version in the error
// body (serverApiVersion), which we use instead.
const FALLBACK_API_VERSION = "10.14.1";

async function getApiVersion(): Promise<string> {
	if (apiVersion) return apiVersion;
	try {
		const res = await axios.get(`${config.baseUrl}/api`, {
			headers: {
				"User-Agent": USER_AGENT,
				Api: `Tgstation.Server.Api/${FALLBACK_API_VERSION}`,
			},
		});
		apiVersion = res.data.apiVersion as string | undefined;
	} catch (err) {
		const reportedVersion = axios.isAxiosError(err)
			? (err.response?.data as { serverApiVersion?: string } | undefined)?.serverApiVersion
			: undefined;
		if (!reportedVersion) throw err;
		apiVersion = reportedVersion;
	}
	if (!apiVersion) throw new Error("TGS did not report an apiVersion");
	return apiVersion;
}

async function login(): Promise<string> {
	const version = await getApiVersion();
	const res = await axios.post(`${config.baseUrl}/api`, undefined, {
		headers: {
			Authorization: `Basic ${Buffer.from(`${config.username}:${config.password}`).toString("base64")}`,
			Api: `Tgstation.Server.Api/${version}`,
			"User-Agent": USER_AGENT,
		},
	});

	const bearer = res.data.bearer as string | undefined;
	if (!bearer) throw new Error("TGS login did not return a bearer token");

	const decoded = jwt.decode(bearer) as { exp?: number } | null;
	tokenExpiresAt = decoded?.exp ? decoded.exp * 1000 : Date.now() + 60_000;
	token = bearer;
	return token;
}

async function ensureToken(): Promise<string> {
	if (token && tokenExpiresAt - Date.now() > 5_000) return token;
	return login();
}

export async function getDreamDaemonStatus(): Promise<DreamDaemonResponse> {
	const version = await getApiVersion();
	const request = (bearer: string) =>
		axios.get<DreamDaemonResponse>(`${config.baseUrl}/api/DreamDaemon`, {
			headers: {
				Authorization: `Bearer ${bearer}`,
				Api: `Tgstation.Server.Api/${version}`,
				Instance: String(config.instanceId),
				"User-Agent": USER_AGENT,
			},
		});

	const bearer = await ensureToken();
	try {
		return (await request(bearer)).data;
	} catch (err) {
		if (axios.isAxiosError(err) && err.response?.status === 401) {
			// token may have been invalidated early on TGS' side - login once more before giving up
			token = undefined;
			return (await request(await login())).data;
		}
		throw err;
	}
}
