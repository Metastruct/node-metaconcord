import { APIEmbed } from "discord.js";
import { GameBridge, GameServer, Player } from "../../gamebridge";
import { PathLike, promises as fs } from "fs";
import { WebApp } from "..";
import { clamp } from "@/utils";
import Discord from "discord.js";
import SteamID from "steamid";
import apikeys from "@/config/apikeys.json";
import config from "@/config/webapp.json";
import express from "express";
import request, { gql } from "graphql-request";
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

const AddonURIS = {
	acf: "https://github.com/metastruct/ACF/blob/master/",
	advdupe2: "https://github.com/wiremod/advdupe2/blob/master/",
	aowl: "https://gitlab.com/metastruct/internal/aowl/-/blob/master/",
	easychat: "https://github.com/Earu/EasyChat/blob/master/",
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

const LINES = 10;
const LOOKUP_PATH = config.lookupPath;

async function exists(path: PathLike): Promise<boolean> {
	return fs
		.access(path)
		.then(() => true)
		.catch(() => false);
}

async function getSnippet(smg: StackMatchGroups): Promise<string | undefined> {
	const path = LOOKUP_PATH + smg.path;
	if (await exists(path)) {
		const file = await fs.readFile(path, "utf8");
		const lines = file.split(/\r?\n/);
		const line = Number(smg.lino) - 1;
		return lines
			.slice(
				clamp(line - LINES / 2, 0, lines.length),
				clamp(line + LINES / 2, 0, lines.length)
			)
			.join("\n");
	} else {
		const url: string | undefined = smg.addon ? AddonURIS[smg.addon] : undefined;

		if (url) {
			const provider = url.match(/([^\.\/]+)\.com/);
			if (!provider) return;
			const isGithub = provider[1] === "github";
			const endpoint = isGithub
				? "https://api.github.com/graphql"
				: "https://gitlab.com/api/graphql";
			const repo = smg.addon;
			const owner = url.match(/\.com\/(.+?)\//);
			const branch = url.split("/").at(-2);

			if (!owner) return;
			const query = isGithub
				? gql`{
		repository(owner:"${owner[1]}", name:"${repo}") {
			content: object(expression:"${branch}:${smg.path}") {
				... on Blob {
					text
				}
			}
		}
}
`
				: gql`{
	project(fullpath:"${url.match(/\.com\/(.+?)\/\-/)}") {
		repository {
			blobs(paths:"${smg.path}"){
				nodes{rawTextBlob}
			}
		}
	}
}
`;
			try {
				const res = await request(endpoint, query, undefined, {
					authorization: `Bearer ${isGithub ? apikeys.github : apikeys.gitlab}`,
				});
				if (res) {
					const filecontent = isGithub
						? (res.data.repository.content.text as string)
						: (res.data.project.repository.blobs.nodes[0].rawTextBlob as string);
					const line = Number(smg.lino) - 1;
					const lines = filecontent.split(/\r?\n/);
					return lines
						.slice(
							clamp(line - LINES / 2, 0, lines.length),
							clamp(line + LINES / 2, 0, lines.length)
						)
						.join("\n");
				}
				console.error(res);
				return;
			} catch (err) {
				console.error(JSON.stringify(err, undefined, 2));
				return;
			}
		}
	}
}

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
			const embeds: APIEmbed[] = [];
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
				if (player.isPirate) return; // dont care about pirates

				const steam = gameBridge.container.getService("Steam");
				if (steam) {
					const steamid = steam.accountIDToSteamID(player.accountId);
					if (body.error.includes(steamid.replace(/^STEAM_/, ""))) return; // custom scripts by player ran with luadev
				}

				embed.author = {
					name: player.nick,
					icon_url: (player.avatar as string) ?? undefined,
					url: `https://steamcommunity.com/profiles/[U:1:${player.accountId}]`,
				};
				if (player.isLinux) embed.fields = [{ name: "OS:", value: "UNIX", inline: true }];
			}
			if (server) {
				embed.author = {
					name: server.name,
				};
				if (gameserver) {
					embed.fields = [
						{
							name: "Map Uptime:",
							value: `<t:${gameserver?.mapUptime.toString()}:R>`,
							inline: true,
						},
					];
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
			const matches = [...body.stack.matchAll(megaRex)];
			const filematch = matches.filter(
				m => !m.groups?.engine && Number(m.groups?.stacknr) < 3
			);
			if (filematch.length > 0) {
				const smg = filematch[0].groups as StackMatchGroups;
				await getSnippet(smg).then(res => {
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
