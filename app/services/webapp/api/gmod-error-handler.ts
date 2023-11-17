import { AddonURIS, getOrFetchLuaFile } from "@/utils";
import { GameBridge, GameServer, Player } from "../../gamebridge";
import { WebApp } from "..";
import Discord from "discord.js";
import SteamID from "steamid";
import config from "@/config/webapp.json";
import dayjs from "dayjs";
import express from "express";
import servers from "@/config/gamebridge.servers.json";

type GmodResponse = {
	addon: string;
	ds: string;
	error: string;
	gamemode: string;
	gmv: string;
	hash: string;
	os: string;
	realm: "server" | "client";
	stack: string;
	v: string;
};

type StackMatchGroups = {
	addon?: string;
	cmdname?: string;
	cmdrealm?: string;
	engine?: string;
	ext?: string;
	filename?: string;
	fn: string;
	lino: string;
	nick?: string;
	partialsteamid?: string;
	path?: string;
	runnables?: string;
	rfilename?: string;
	stacknr: string;
	steamid: string;
	steamnick?: string;
};

const megaRex =
	/(?<stacknr>\d+)\. (?<fn>\S+) - (?<runnables>RunString|LuaCmd|LUACMD)?(\[(?<steamid>STEAM_\d:\d:\d+)\](?<steamnick>.+))?(<(?<partialsteamid>\d:\d:\d+)\|(?<nick>.+?)>)?(<(?<rfilename>[^:]+)>)?(<(?<cmdname>.+):(?<cmdrealm>.+)>)?(?<engine>\[C\])?(?<path>(?:lua|gamemodes)\/(?<addon>[-_.A-Za-z0-9]+?)(?:\/.*)?\/(?<filename>[-_.A-Za-z0-9]+)\.(?<ext>lua))?:(?<lino>-?\d+)/g;

const SuperReplacer = (_: string, ...args: any[]) => {
	const groups = args.at(-1) as StackMatchGroups;
	return `${groups.stacknr}. ${groups.fn} - ${
		groups.steamid
			? `\[[${groups.steamid}\]${
					groups.steamnick
			  }](http://steamcommunity.com/profiles/${new SteamID(groups.steamid).getSteamID64()})`
			: groups.partialsteamid
			? groups.rfilename
				? `<[${groups.partialsteamid} |${
						groups.nick
				  }](http://steamcommunity.com/profiles/${new SteamID(
						`STEAM_${groups.partialsteamid}`
				  ).getSteamID64()})><${groups.rfilename}>`
				: `<[${groups.partialsteamid} |${
						groups.nick
				  }](http://steamcommunity.com/profiles/${new SteamID(
						`STEAM_${groups.partialsteamid}`
				  ).getSteamID64()})><${groups.cmdname}:${groups.cmdrealm}>`
			: groups.path
			? groups.addon &&
			  AddonURIS[
					groups.addon === "mta" && groups.path.split("/", 1)[0] === "gamemodes"
						? "mta_gamemode"
						: groups.addon
			  ]
				? `[${groups.path}](${AddonURIS[groups.addon] + groups.path}#L${groups.lino})`
				: groups.path
			: groups.engine
	}:${groups.lino}`;
};

const gamemodes = ["sandbox_modded", "mta", "jazztronauts"]; //proper gamemode support when???
const funcIgnore = ["CreateFont", "require"];
const ignoreRegex = [
	/Warning! A net message \(.+\) is already started! Discarding in favor of the new message! \(.+\)/g,
	/unsuccessful/,
];
//const fileIgnore = [];

export default (webApp: WebApp): void => {
	let gameBridge: GameBridge;

	const webhook = new Discord.WebhookClient({
		url: config.webhookUrl,
	});

	const pac_error_webhook = new Discord.WebhookClient({
		url: config.pacWebhookUrl,
	});

	webApp.app.post("/gmod/errors", express.urlencoded({ extended: false }), async (req, res) => {
		const ip = req.header("x-forwarded-for")?.split(",")[0];
		if (!ip) return res.sendStatus(403);

		const body = req.body as GmodResponse;
		if (!body) return res.status(400).end();
		res.status(204);
		res.end();

		gameBridge = gameBridge || webApp.container.getService("GameBridge");

		const server = servers.find(srv => srv.ip === ip);
		let gameserver: GameServer;
		let player: Player | undefined;
		if (server) {
			// ip matched so it HAS to exist
			gameserver = gameBridge.servers.filter(server => server.config.ip === ip)[0];
		} else {
			const allplayers = gameBridge.servers.reduce(
				(ps, cs) => ps.concat(cs.status.players),
				new Array<Player>()
			);
			player = allplayers.find(pl => pl.ip.split(":")[0] === ip); // idk if you can combine that into one call
			gameserver = gameBridge.servers.filter(srv =>
				srv.status.players.includes(player as Player)
			)[0];
		}

		if (body.realm === "client" && !gamemodes.includes(body.gamemode)) {
			return;
		} // external players?
		if (body.realm === "server" && !server) {
			return;
		} // external servers?

		if (body.stack) {
			if (body.error.startsWith("@repl_")) {
				return;
			} // gcompute
			if (body.error.startsWith("SF:")) {
				return;
			} // starfall

			for (const regex of ignoreRegex) {
				if (body.error.match(regex)) {
					return;
				}
			}

			const stack = body.stack.replaceAll(megaRex, SuperReplacer);
			const matches = [...body.stack.matchAll(megaRex)];
			if (
				body.realm === "client" &&
				matches.some(
					m =>
						m.groups?.steamid ||
						m.groups?.partialsteamid ||
						m.groups?.runnables ||
						(m.groups?.fn && funcIgnore.includes(m.groups?.fn)) //||
					//	(m.groups?.filename && fileIgnore.includes(m.groups?.filename))
				)
			) {
				return; // player (self) errors
			}
			if (
				matches.some(
					m => m.groups?.fn && funcIgnore.includes(m.groups?.fn) //||
					// (m.groups?.filename && fileIgnore.includes(m.groups?.filename))
				)
			) {
				return;
			}
			const embeds: Discord.APIEmbed[] = [];

			// main embed
			const embed: Discord.APIEmbed = {
				description: stack.replaceAll("```", "​`​`​`"),
				footer: {
					text: `${body.gamemode}@${
						body.realm === "server"
							? server?.name ?? `unknown server(${ip})`
							: gameserver
							? gameserver.config.name
							: body.realm
					}`,
				},
				color: server ? 0x03a9f4 : 0xdea909,
			};
			embed.fields = [];
			if (player) {
				if (player.isPirate) {
					return;
				} // dont care about pirates

				embed.author = {
					name: player.nick,
					icon_url: (player.avatar as string) ?? undefined,
					url: `https://steamcommunity.com/profiles/[U:1:${player.accountId}]`,
				};
				if (player.isLinux) embed.fields = [{ name: "OS:", value: "UNIX", inline: true }];
			}
			if (server) {
				if (gameserver) {
					if (gameserver.mapUptime) {
						embed.fields.push({
							name: "Map running since:",
							value: `<t:${dayjs().subtract(gameserver.mapUptime, "s").unix()}:R>`,
							inline: true,
						});
					}
					if (
						gameserver.config.defaultGamemode &&
						body.gamemode !== gameserver.config.defaultGamemode
					) {
						const gamemode = gameserver.gamemode ?? {
							folderName: "???",
							name: body.gamemode,
						};

						embed.fields.push({
							name: "Gamemode:",
							value: `${gamemode.name} (${gamemode.folderName})`,
							inline: true,
						});
					}
				}
			}
			embeds.push(embed);
			const payload: Discord.MessageCreateOptions = {
				allowedMentions: { parse: [] },
				content: `**${body.error.replaceAll("*", "\\*")}**`,
				embeds: embeds,
			};

			// code embed

			const filematch = matches.filter(
				m => !m.groups?.engine && Number(m.groups?.stacknr) < 3
			);
			if (filematch.length > 0) {
				const smg = filematch[0].groups as StackMatchGroups;
				if (!smg.path) return;
				await getOrFetchLuaFile(smg.path, Number(smg.lino), smg.addon).then(res => {
					if (res && smg.filename) {
						payload.files = [
							{
								attachment: Buffer.from(res),
								name: `${smg.filename}.${smg.ext}`,
							},
						];
					}
				});
			}
			if (body.v === "test") return;
			if (matches.some(m => (m.groups as StackMatchGroups).addon === "pac3")) {
				pac_error_webhook.send(payload).catch(console.error);
			} else {
				webhook.send(payload).catch(console.error);
			}
		}
	});
};
