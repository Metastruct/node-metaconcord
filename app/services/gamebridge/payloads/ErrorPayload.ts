import * as requestSchema from "./structures/ErrorRequest.json";
import * as responseSchema from "./structures/ErrorResponse.json";
import { APIEmbed } from "discord.js";
import { ErrorRequest, ErrorResponse } from "./structures";
import { GameServer } from "..";
import Payload from "./Payload";

export default class ErrorPayload extends Payload {
	protected static requestSchema = requestSchema;
	protected static responseSchema = responseSchema;

	// static async initialize(server: GameServer): Promise<void> {
	// }

	static async handle(payload: ErrorRequest, server: GameServer): Promise<void> {
		super.handle(payload, server);
		const { bridge, discord, discordEWH } = server;

		const { hook_error } = payload.data;

		const webhook = discordEWH;

		const embed: APIEmbed = {
			title: hook_error.identifier,
			description: hook_error.error.replace("`", "\\`"),
		};

		webhook.send({
			allowedMentions: { parse: [] },
			content: `**${hook_error.name} Hook Failed!**`,
			embeds: [embed],
		});
	}

	static async send(payload: ErrorResponse, server: GameServer): Promise<void> {
		super.send(payload, server);
	}
}
