import { APIEmbed } from "discord.js";
import { AddonURIS, getOrFetchLuaFile } from "@/utils";
import { GameBridge, GameServer, Player } from "../../gamebridge";
import { WebApp } from "..";
import Discord from "discord.js";
import SteamID from "steamid";
import config from "@/config/webapp.json";
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
	path?: string;
	rfilename?: string;
	stacknr: string;
	steamid: string;
};

const megaRex =
	/(?<stacknr>\d+)\. (?<fn>\S+) - (<(?<steamid>\d:\d:\d+)\|(?<nick>.+?)>)?(<(?<rfilename>[^:]+)>)?(<(?<cmdname>.+):(?<cmdrealm>.+)>)?(?<engine>\[C\])?(?<path>(?:lua|gamemodes)\/(?<addon>[-_.A-Za-z0-9]+?)(?:\/.*)?\/(?<filename>[-_.A-Za-z0-9]+)\.(?<ext>lua))?:(?<lino>-?\d+)/g;

const SuperReplacer = (_: string, ...args: any[]) => {
	const groups = args.at(-1);
	return `${groups.stacknr}. ${groups.fn} - ${
		groups.steamid
			? groups.rfilename
				? `<[${groups.steamid} |${
						groups.nick
				  }](http://steamcommunity.com/profiles/${new SteamID(
						`STEAM_${groups.steamid}`
				  ).getSteamID64()})><${groups.rfilname}>`
				: `<[${groups.steamid} |${
						groups.nick
				  }](http://steamcommunity.com/profiles/${new SteamID(
						`STEAM_${groups.steamid}`
				  ).getSteamID64()})><${groups.cmdname}:${groups.cmdrealm}>`
			: groups.path
			? AddonURIS[groups.addon]
				? `[${groups.path}](${AddonURIS[groups.addon] + groups.path}#L${groups.lino})`
				: groups.path
			: groups.engine
	}:${groups.lino}`;
};

const gamemodes = ["sandbox_modded", "mta", "jazztronauts"]; //proper gamemode support when???

export default (webApp: WebApp): void => {
	let gameBridge: GameBridge;
	const webhook = new Discord.WebhookClient({
		url: config.webhookUrl,
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

		if (body.realm === "client" && !gamemodes.includes(body.gamemode)) return; // external players?
		if (body.realm === "server" && !server) return; // external servers?

		if (body.stack) {
			if (body.error.startsWith("@repl_")) return; // gcompute
			if (body.error.startsWith("SF:")) return; // starfall

			const stack = body.stack.replaceAll(megaRex, SuperReplacer);
			const matches = [...body.stack.matchAll(megaRex)];
			if (body.realm === "client" && matches.find(m => !m.groups?.steamid)) return; // player (self) errors
			const embeds: APIEmbed[] = [];

			// main embed
			const embed: APIEmbed = {
				description: stack.replace("`", "\\`"),
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
				if (player.isPirate) return; // dont care about pirates

				embed.author = {
					name: player.nick,
					icon_url: (player.avatar as string) ?? undefined,
					url: `https://steamcommunity.com/profiles/[U:1:${player.accountId}]`,
				};
				if (player.isLinux) embed.fields = [{ name: "OS:", value: "UNIX", inline: true }];
			}
			if (server) {
				if (gameserver) {
					if (gameserver?.mapUptime) {
						embed.fields.push({
							name: "Map running since:",
							value: `<t:${gameserver?.mapUptime.toString()}:R>`,
							inline: true,
						});
					}
					if (
						gameserver.config.defaultGamemode &&
						body.gamemode !== gameserver.config.defaultGamemode
					) {
						embed.fields.push({
							name: "Gamemode:",
							value: `${gameserver.gamemode.name} (${gameserver.gamemode.folderName})`,
							inline: true,
						});
					}
				}
			}
			embeds.push(embed);

			// code embed

			const filematch = matches.filter(
				m => !m.groups?.engine && Number(m.groups?.stacknr) < 3
			);
			if (filematch.length > 0) {
				const smg = filematch[0].groups as StackMatchGroups;
				if (!smg.path) return;
				await getOrFetchLuaFile(smg.path, Number(smg.lino), smg.addon).then(res => {
					if (res) {
						embeds.push({ description: `\`\`\`lua\n${res}\`\`\`` });
					}
				});
			}

			if (body.v === "test") return;
			webhook
				.send({
					allowedMentions: { parse: [] },
					content: `**${body.error.replace("*", "\\*")}**`,
					embeds: embeds,
				})
				.catch(console.error);
		}
	});
};
