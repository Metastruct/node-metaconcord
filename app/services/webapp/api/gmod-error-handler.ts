import { APIEmbed } from "discord.js";
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

const AddonURIS = {
	acf: "https://github.com/metastruct/ACF/blob/master/",
	advdupe2: "https://github.com/wiremod/advdupe2/blob/master/",
	aowl: "https://gitlab.com/metastruct/internal/aowl/-/blob/master/",
	epoe: "https://github.com/Metastruct/EPOE/blob/master/",
	fast_addons: "https://gitlab.com/metastruct/internal/fast_addons/-/blob/master/",
	gcompute: "https://github.com/Metastruct/gcompute/blob/master/",
	luadev: "https://github.com/Metastruct/luadev/blob/master/",
	metaconcord: "https://github.com/metastruct/gmod-metaconcord/blob/master/",
	metastruct: "https://gitlab.com/metastruct/internal/metastruct/-/blob/master/",
	metaworks: "https://gitlab.com/metastruct/metaworks/MetaWorks/-/blob/master",
	mta: "https://gitlab.com/metastruct/mta_projects/mta/-/blob/master/",
	pac3: "https://github.com/CapsAdmin/pac3/blob/develop/",
	sandbox_modded: "https://gitlab.com/metastruct/internal/qbox/-/blob/master/",
	swcs: "https://gitlab.com/cynhole/swcs/-/blob/master/",
	vrmod: "https://github.com/Metastruct/vrmod-addon/blob/master/",
	wire: "https://github.com/Metastruct/wire/blob/master/",
};

const megaRex =
	/(?<stacknr>\d+)\. (?<fn>\S+) - (<(?<steamid>\d:\d:\d+)\|(?<nick>.+?)>)?(<(?<rfilename>[^:]+)>)?(<(?<cmdname>.+):(?<cmdrealm>.+)>)?(?<engine>\[C\])?(?<path>(?:lua|gamemodes)\/(?<addon>\w+?)(?:\/.*)?\/(?<filename>\w+)\.(?<ext>lua))?:(?<lino>-?\d+)/g;

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
		let gameserver: GameServer | undefined;
		let player: Player | undefined;
		if (server) {
			gameserver = gameBridge.servers.filter(server => server.config.ip === ip)[0];
		} else {
			const allplayers = gameBridge.servers.reduce(
				(ps, cs) => ps.concat(cs.status.players),
				new Array<Player>()
			);
			player = allplayers.find(pl => pl.ip.split(":")[0] === ip); // idk if you can combine that into one call
			gameserver = gameBridge.servers.find(srv =>
				srv.status.players.includes(player as Player)
			);
		}

		if (body.realm === "client" && !gamemodes.includes(body.gamemode)) return; // external players?
		if (body.realm === "server" && !server) return; // external servers?

		if (body.stack) {
			if (body.error.startsWith("@repl_")) return;
			const stack = body.stack.replaceAll(megaRex, SuperReplacer);
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
			if (player) {
				embed.author = {
					name: player.nick,
					icon_url: (player.avatar as string) ?? undefined,
					url: `https://steamcommunity.com/profiles/[U:1:${player.accountId}]`,
				};
			}
			if (server) {
				embed.author = {
					name: server.name,
				};
			}
			if (body.v === "test") return;
			webhook
				.send({
					allowedMentions: { parse: [] },
					content: `**${body.error.replace("*", "\\*")}**`,
					embeds: [embed],
				})
				.catch(console.error);
		}
	});
};
