import { APIEmbed } from "discord.js";
import { ErrorRequest, ErrorResponse } from "./structures/index.js";
import { GMOD_PATH_MATCH, getOrFetchGmodFile } from "@/utils.js";
import GameServer from "@/app/services/gamebridge/GameServer.js";
import Payload from "./Payload.js";
import dayjs from "dayjs";
import requestSchema from "./structures/ErrorRequest.json" with { type: "json" };
import responseSchema from "./structures/ErrorResponse.json" with { type: "json" };

export default class ErrorPayload extends Payload {
	protected static requestSchema = requestSchema;
	protected static responseSchema = responseSchema;
	private static lastError: ErrorRequest["data"]["hook_error"];

	// static async initialize(server: GameServer): Promise<void> {
	// }

	static async handle(payload: ErrorRequest, server: GameServer): Promise<void> {
		super.handle(payload, server);
		const { bridge } = server;

		const { hook_error } = payload.data;

		if (hook_error.name.includes("@repl_") || this.lastError === hook_error) return;

		const webhook = bridge.discordErrorWH;
		const pacWebhook = bridge.discordPacErrorWH;

		const lines = hook_error.errormsg.split(/\r?\n/);
		const err = lines[0];
		const [path, linenr] = err.split(":", 2);
		const stack = lines.splice(2).map((l, i) => `${i + 1}. ${l}`);
		const file = await getOrFetchGmodFile(path + ":" + linenr);
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		const [, fpath, addon, filename, ext, linenos, linenoe] =
			new RegExp(GMOD_PATH_MATCH).exec(<string>path) || [];
		const embeds: APIEmbed[] = [];
		const embed = {
			title: hook_error.name,
			description: stack.join("\n").replaceAll("```", "​`​`​`"),
			footer: {
				text: `${
					server.gamemode
						? (server.gamemode.name ?? server.gamemode.folderName)
						: "No gamemode name"
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
		this.lastError = hook_error;
		if (addon === "pac3") {
			pacWebhook?.send({
				allowedMentions: { parse: [] },
				content: `**${hook_error.identifier} Hook Failed!\n${err}**`,
				embeds: embeds,
			});
		} else {
			webhook?.send({
				allowedMentions: { parse: [] },
				content: `**${hook_error.identifier} Hook Failed!\n${err}**`,
				embeds: embeds,
			});
		}
	}

	static async send(payload: ErrorResponse, server: GameServer): Promise<void> {
		super.send(payload, server);
	}
}
