import { APIEmbed } from "discord.js";
import { GameBridge } from "../../gamebridge";
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
	advdupe2: "https://github.com/wiremod/advdupe2/blob/master/",
	aowl: "https://gitlab.com/metastruct/internal/aowl/-/blob/master/",
	epoe: "https://github.com/Metastruct/EPOE/blob/master/",
	fast_addons: "https://gitlab.com/metastruct/internal/fast_addons/-/blob/master/",
	gcompute: "https://github.com/Metastruct/gcompute/blob/master/",
	luadev: "https://github.com/Metastruct/luadev/blob/master/",
	metaconcord: "https://github.com/metastruct/gmod-metaconcord/blob/master/",
	metastruct: "https://gitlab.com/metastruct/internal/metastruct/-/blob/master/",
	mta: "https://gitlab.com/metastruct/mta_projects/mta/-/blob/master/",
	pac3: "https://github.com/CapsAdmin/pac3/blob/develop/",
	sandbox_modded: "https://gitlab.com/metastruct/internal/qbox/-/blob/master/",
	swcs: "https://gitlab.com/cynhole/swcs/-/blob/master",
	wire: "https://github.com/Metastruct/wire/blob/master/",
};

export default (webApp: WebApp): void => {
	let gameBridge: GameBridge;
	const webhook = new Discord.WebhookClient({
		url: config.webhookUrl,
	});

	webApp.app.post("/gmod/errors", express.urlencoded({ extended: false }), async (req, res) => {
		const ip = req.header("x-forwarded-for")?.split(",")[0];
		const server = servers.find(srv => srv.ip === ip);
		if (!ip) return res.sendStatus(403);
		// const isOkIp = servers.find(srv => srv.ip === ip);
		// if (!isOkIp) {
		// 	console.log(ip);
		// 	return res.sendStatus(403);
		// }
		const body = req.body as GmodResponse;
		if (!body) return res.status(400).end();
		res.status(204);
		res.end();

		if (
			body.realm === "client" &&
			body.gamemode !== "sandbox_modded" &&
			body.gamemode !== "mta"
		)
			return;
		if (body.realm === "server" && !server) return;
		//gameBridge = gameBridge || webApp.container.getService("GameBridge");

		const megaRex =
			/(?<stacknr>\d+)\. (?<fn>\S+) - (<(?<steamid>\d:\d:\d+)\|(?<nick>.+?)>)?(<(?<rfilename>[^:]+)>)?(<(?<cmdname>.+):(?<cmdrealm>.+)>)?(?<engine>\[C\])?(?<path>(?:lua|gamemodes)\/(?<addon>\w+?)(?:\/.*)?\/(?<filename>\w+)\.(?<ext>lua))?:(?<lino>-?\d+)/g;

		if (body.stack) {
			if (body.error.startsWith("@repl_")) return;
			const stack = body.stack.replaceAll(megaRex, (match, ...args) => {
				const groups = args[args.length - 1];
				return `${" ".repeat(groups.stacknr - 1)}${groups.stacknr}. ${groups.fn} - ${
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
							? `[${groups.path}](${AddonURIS[groups.addon] + groups.path}#L${
									groups.lino
							  })`
							: groups.path
						: groups.engine
				}:${groups.lino}`;
			});
			const embed: APIEmbed = {
				description: stack.replace("`", "\\`"),
				footer: {
					text: `${body.gamemode}@${
						body.realm === "server"
							? server?.name ?? `unkown server(${ip})`
							: body.realm
					}`,
				},
			};
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
