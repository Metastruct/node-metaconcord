import * as requestSchema from "./structures/ErrorRequest.json";
import * as responseSchema from "./structures/ErrorResponse.json";
import { APIEmbed } from "discord.js";
import { ErrorRequest, ErrorResponse } from "./structures";
import { GameServer } from "..";
import { getOrFetchLuaFile } from "@/utils";
import Payload from "./Payload";
import dayjs from "dayjs";

export default class ErrorPayload extends Payload {
	protected static requestSchema = requestSchema;
	protected static responseSchema = responseSchema;

	// static async initialize(server: GameServer): Promise<void> {
	// }

	static async handle(payload: ErrorRequest, server: GameServer): Promise<void> {
		super.handle(payload, server);
		const { discordEWH } = server;

		const { hook_error } = payload.data;

		if (hook_error.name.includes("@repl_")) return;

		const webhook = discordEWH;

		const lines = hook_error.errormsg.split(/\r?\n/);
		const err = lines[0];
		const path = err.split(":")[0];
		const linenr = err.split(":")[1];
		const stack = lines.splice(2).map((l, i) => `${i + 1}. ${l}`);
		const file = await getOrFetchLuaFile(path, Number(linenr));
		const embeds: APIEmbed[] = [];
		const embed = {
			title: hook_error.name,
			description: stack.join("\n").replace("`", "\\`"),
			footer: {
				text: `${
					server.gamemode.name ?? server.gamemode.folderName ?? "No gamemode name"
				}@${server.config.name}`,
			},
			fields: [
				{
					name: "Map running since:",
					value: `<t:${dayjs().subtract(server.mapUptime, "s").unix()}:R>`,
				},
			],
			color: 0x03a9f4,
		};

		if (file) {
			embed.title = "";
			embeds.push(embed);
			embeds.push({
				title: hook_error.name,
				description: `\`\`\`lua\n${file}\`\`\``,
			});
		} else {
			embeds.push(embed);
		}

		webhook.send({
			allowedMentions: { parse: [] },
			content: `**${hook_error.identifier} Hook Failed!\n${err}**`,
			embeds: embeds,
		});
	}

	static async send(payload: ErrorResponse, server: GameServer): Promise<void> {
		super.send(payload, server);
	}
}
