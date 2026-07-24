import { APIEmbed } from "discord.js";
import { ErrorRequest, ErrorResponse } from "./structures/index.js";
import { getOrFetchGmodFile, matchGmodPath } from "@/utils.js";
import GmodConnection from "@/app/services/gamebridge/games/gmod/GmodConnection.js";
import Payload from "./Payload.js";
import dayjs from "dayjs";
import { errorWebhook, pacErrorWebhook } from "../webhooks.js";
import requestSchema from "./structures/ErrorRequest.json" with { type: "json" };
import responseSchema from "./structures/ErrorResponse.json" with { type: "json" };

export default class ErrorPayload extends Payload {
	protected static requestSchema = requestSchema;
	protected static responseSchema = responseSchema;
	private static lastError: ErrorRequest["data"]["hook_error"];

	// static async initialize(server: GmodConnection): Promise<void> {
	// }

	static async handle(payload: ErrorRequest, server: GmodConnection): Promise<void> {
		super.handle(payload, server);

		const { hook_error } = payload.data;

		if (hook_error.name.includes("@repl_") || this.lastError === hook_error) return;

		const lines = hook_error.errormsg.split(/\r?\n/);
		const err = lines[0];
		const [path, linenr] = err.split(":", 2);
		const gpath = matchGmodPath(path);
		const file = gpath.addon
			? await getOrFetchGmodFile(path + ":" + linenr)
			: await getOrFetchGmodFile(lines.find(l => matchGmodPath(l.split(":")[0]).addon));
		const stack = lines.splice(2).map((l, i) => `${i + 1}. ${l}`);
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
		if (gpath.addon === "pac3") {
			await pacErrorWebhook
				.send({
					allowedMentions: { parse: [] },
					content: `**${hook_error.identifier} Hook Failed!\n${err}**`,
					embeds: embeds,
				})
				.catch(() => {});
		} else {
			await errorWebhook
				.send({
					allowedMentions: { parse: [] },
					content: `**${hook_error.identifier} Hook Failed!\n${err}**`,
					embeds: embeds,
				})
				.catch(() => {});
		}
	}

	static async send(payload: ErrorResponse, server: GmodConnection): Promise<void> {
		super.send(payload, server);
	}
}
