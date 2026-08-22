import * as Discord from "discord.js";
import { WebApp } from "@/app/services/webapp/index.js";
import { logger } from "@/utils.js";

const log = logger(import.meta);

const TTL = 60 * 1000;
const CACHE_CONTROL = "public, max-age=60, stale-while-revalidate=300";
const HORIZON = 90 * 24 * 60 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

/** One occurrence of a scheduled event, for the website's "upcoming events" card. */
export interface UpcomingEvent {
	id: string;
	name: string;
	description?: string;
	/** epoch ms */
	start: number;
	end?: number;
	/** channel name for voice/stage events, free text for external ones */
	location?: string;
	image?: string;
	url: string;
	recurring: boolean;
	interested?: number;
}

let cached: { events: UpcomingEvent[]; expires: number } | undefined;

/** Discord's weekday enum is Monday=0; JS is Sunday=0. */
const jsWeekday = (d: Discord.GuildScheduledEventRecurrenceRuleWeekday): number => (d + 1) % 7;

/**
 * Discord only exposes the next occurrence of a recurring event, so the
 * following ones are derived from the rule. Daily and weekly rules are
 * expanded; monthly and yearly ones only contribute the occurrence Discord gives.
 */
function occurrences(event: Discord.GuildScheduledEvent, now: number): number[] {
	const first = event.scheduledStartTimestamp;
	if (!first) return [];
	const rule = event.recurrenceRule;
	const Frequency = Discord.GuildScheduledEventRecurrenceRuleFrequency;
	if (!rule || (rule.frequency !== Frequency.Weekly && rule.frequency !== Frequency.Daily)) {
		return first >= now ? [first] : [];
	}

	const out: number[] = [];
	const ruleStart = rule.startTimestamp;
	const until = Math.min(now + HORIZON, rule.endTimestamp ?? Infinity);
	// Discord's own next occurrence is authoritative for its weekday; byWeekday is
	// authored in the creator's timezone, so it only adds the other days of multi-day rules.
	const weekdays = new Set((rule.byWeekday ?? []).map(jsWeekday));
	weekdays.add(new Date(first).getUTCDay());

	for (let t = first; t <= until && out.length < 10; t += DAY) {
		const days = Math.round((t - ruleStart) / DAY);
		const onCadence =
			rule.frequency === Frequency.Daily
				? days % rule.interval === 0
				: Math.floor(days / 7) % rule.interval === 0 &&
					weekdays.has(new Date(t).getUTCDay());
		if (onCadence && t >= now) out.push(t);
	}
	return out;
}

async function upcoming(guild: Discord.Guild): Promise<UpcomingEvent[]> {
	const now = Date.now();
	const events = await guild.scheduledEvents.fetch({ withUserCount: true });
	const out: UpcomingEvent[] = [];

	for (const event of events.values()) {
		if (event.status === Discord.GuildScheduledEventStatus.Completed) continue;
		if (event.status === Discord.GuildScheduledEventStatus.Canceled) continue;

		const duration =
			event.scheduledEndTimestamp && event.scheduledStartTimestamp
				? event.scheduledEndTimestamp - event.scheduledStartTimestamp
				: undefined;
		const location =
			event.entityType === Discord.GuildScheduledEventEntityType.External
				? (event.entityMetadata?.location ?? undefined)
				: (event.channel?.name ?? undefined);

		for (const start of occurrences(event, now)) {
			out.push({
				id: `${event.id}-${start}`,
				name: event.name,
				description: event.description ?? undefined,
				start,
				end: duration ? start + duration : undefined,
				location,
				image: event.coverImageURL({ size: 1024 }) ?? undefined,
				url: event.url,
				recurring: !!event.recurrenceRule,
				interested: event.userCount ?? undefined,
			});
		}
	}

	return out.sort((a, b) => a.start - b.start);
}

/** Upcoming scheduled events of the Discord guild, recurring ones expanded. */
export default (webApp: WebApp): void => {
	webApp.app.get("/discord/guild/events", async (req, res) => {
		const guild = webApp.container.getService("DiscordBot").getGuild();
		if (!guild) {
			res.status(503).json({ error: "bot is not in the guild" });
			return;
		}

		if (!cached || cached.expires < Date.now()) {
			try {
				cached = { events: await upcoming(guild), expires: Date.now() + TTL };
			} catch (err) {
				log.warn(err, "failed fetching scheduled events");
				if (!cached) {
					res.status(502).json({ error: "events unavailable" });
					return;
				}
			}
		}

		const limit = Math.min(Math.max(Number(req.query.limit) || 3, 1), 10);
		res.set("Cache-Control", CACHE_CONTROL);
		res.json({ events: cached.events.slice(0, limit) });
	});
};
