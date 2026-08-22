import type { Request, Response } from "express";
import { Octokit } from "@octokit/rest";
import { WebApp } from "@/app/services/webapp/index.js";
import { rateLimitKeyGenerator } from "@/app/services/webapp/rateLimit.js";
import { rateLimit } from "express-rate-limit";
import express from "express";
import { requireEditor } from "./github-auth.js";
import HistoryConfig from "@/config/history.json" with { type: "json" };
import { logger } from "@/utils.js";

const log = logger(import.meta);

/**
 * Timeline events for the website, stored as a JSON array in a GitHub repo and
 * edited with the logged-in user's own token so every change is a commit in their name.
 * Reads go straight to raw.githubusercontent.com, there is no GET here.
 */
export type HistoryEvent = {
	id: string;
	/** YYYY-MM-DD */
	date: string;
	name: string;
	description: string;
	url?: string;
	imageUrl?: string;
};

const FILE = {
	owner: HistoryConfig.owner,
	repo: HistoryConfig.repo,
	path: HistoryConfig.path,
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const URL_RE = /^(https?:\/\/|\/(?!\/))\S*$/;

const slugify = (s: string): string =>
	s
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 48) || "event";

const validate = (input: unknown): HistoryEvent | string => {
	if (!input || typeof input !== "object") return "event must be an object";
	const e = input as Record<string, unknown>;
	const name = typeof e.name === "string" ? e.name.trim() : "";
	const description = typeof e.description === "string" ? e.description.trim() : "";
	const date = typeof e.date === "string" ? e.date.slice(0, 10) : "";
	const url = typeof e.url === "string" ? e.url.trim() : "";
	const imageUrl = typeof e.imageUrl === "string" ? e.imageUrl.trim() : "";

	if (!name || name.length > 255) return "name is required (max 255 chars)";
	if (description.length > 2000) return "description too long (max 2000 chars)";
	if (!DATE_RE.test(date) || Number.isNaN(Date.parse(date))) return "date must be YYYY-MM-DD";
	if (url && (url.length > 2100 || !URL_RE.test(url)))
		return "url must be http(s) or a site path";
	if (imageUrl && (imageUrl.length > 2100 || !URL_RE.test(imageUrl)))
		return "imageUrl must be http(s) or a site path";

	const out: HistoryEvent = { id: "", date, name, description };
	if (url) out.url = url;
	if (imageUrl) out.imageUrl = imageUrl;
	return out;
};

const sortEvents = (events: HistoryEvent[]): HistoryEvent[] =>
	events.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));

const uniqueId = (events: HistoryEvent[], ev: HistoryEvent): string => {
	const base = `${ev.date}-${slugify(ev.name)}`;
	let id = base;
	for (let n = 2; events.some(e => e.id === id); n++) id = `${base}-${n}`;
	return id;
};

const readFile = async (octokit: Octokit) => {
	const { data } = await octokit.repos.getContent({ ...FILE, ref: HistoryConfig.branch });
	if (Array.isArray(data) || data.type !== "file") throw new Error("history path is not a file");
	const content = Buffer.from(data.content, "base64").toString("utf8");
	const events = (content.trim() ? JSON.parse(content) : []) as HistoryEvent[];
	if (!Array.isArray(events)) throw new Error("history file is not an array");
	return { events, sha: data.sha };
};

const writeFile = async (
	octokit: Octokit,
	events: HistoryEvent[],
	sha: string,
	message: string
) => {
	const content = JSON.stringify(sortEvents(events), null, 2) + "\n";
	const { data } = await octokit.repos.createOrUpdateFileContents({
		...FILE,
		branch: HistoryConfig.branch,
		sha,
		message,
		content: Buffer.from(content, "utf8").toString("base64"),
	});
	return data.commit.html_url;
};

type Mutation = (
	events: HistoryEvent[]
) => { events: HistoryEvent[]; event: HistoryEvent; message: string } | string;

const mutate = async (req: Request, res: Response, fn: Mutation): Promise<void> => {
	const session = requireEditor(req, res);
	if (!session) return;
	const octokit = new Octokit({ auth: session.token });

	try {
		const { events, sha } = await readFile(octokit);
		const result = fn(events);
		if (typeof result === "string") {
			res.status(400).json({ error: result });
			return;
		}
		const commitUrl = await writeFile(octokit, result.events, sha, result.message);
		log.info(`${session.login}: ${result.message}`);
		// raw.githubusercontent caches for 5 minutes, so the client uses this list instead of refetching
		res.json({ event: result.event, events: result.events, commitUrl });
	} catch (err) {
		const status = (err as { status?: number }).status;
		if (status === 409) {
			res.status(409).json({ error: "history changed concurrently, retry" });
			return;
		}
		if (status === 401 || status === 403 || status === 404) {
			res.status(403).json({ error: "your GitHub token cannot write the history repo" });
			return;
		}
		log.error(err, "history mutation failed");
		res.status(500).json({ error: "history update failed" });
	}
};

export default (webApp: WebApp): void => {
	const limiter = rateLimit({ keyGenerator: rateLimitKeyGenerator, windowMs: 60_000, limit: 30 });
	const json = express.json({ limit: "64kb" });

	webApp.app.post("/history/events", limiter, json, (req, res) =>
		mutate(req, res, events => {
			const ev = validate(req.body?.event);
			if (typeof ev === "string") return ev;
			ev.id = uniqueId(events, ev);
			return { events: [...events, ev], event: ev, message: `Add event: ${ev.name}` };
		})
	);

	webApp.app.put("/history/events/:id", limiter, json, (req, res) =>
		mutate(req, res, events => {
			const index = events.findIndex(e => e.id === req.params.id);
			if (index === -1) return "unknown event id";
			const ev = validate(req.body?.event);
			if (typeof ev === "string") return ev;
			ev.id = events[index].id;
			const next = [...events];
			next[index] = ev;
			return { events: next, event: ev, message: `Update event: ${ev.name}` };
		})
	);

	webApp.app.delete("/history/events/:id", limiter, (req, res) =>
		mutate(req, res, events => {
			const ev = events.find(e => e.id === req.params.id);
			if (!ev) return "unknown event id";
			return {
				events: events.filter(e => e !== ev),
				event: ev,
				message: `Delete event: ${ev.name}`,
			};
		})
	);
};
