import * as SteamID from "steamid";
import * as requestSchema from "./structures/AdminNotifyRequest.json";
import { AdminNotifyRequest } from "./structures";
import { Embed, Markup } from "detritus-client/lib/utils";
import { Steam } from "../../Steam";
import { request as WebSocketRequest } from "websocket";
import Payload from "./Payload";
import app from "@/app";

export default class AdminNotifyPayload extends Payload {
	protected requestSchema = requestSchema;

	async handle(req: WebSocketRequest, payload: AdminNotifyRequest): Promise<void> {
		this.validate(this.requestSchema, payload);

		const { nick, reportedNick, steamId, reportedSteamId } = payload;
		let message = payload.message;

		const callAdminRole = (
			await this.bot.client.rest.fetchGuildRoles(this.bot.gameBridge.config.guildId)
		).find(role => role.id == this.bot.gameBridge.config.callAdminRoleId);
		const notificationsChannel = await this.bot.client.rest.fetchChannel(
			this.bot.gameBridge.config.notificationsChannelId
		);

		const steamId64 = new SteamID(steamId).getSteamID64();
		const reportedSteamId64 = new SteamID(reportedSteamId).getSteamID64();

		// Grab player avatars
		const avatar =
			(await app.container.getService(Steam).getUserSummaries(steamId64))?.avatar?.large ??
			undefined;
		const reportedAvatar =
			(await app.container.getService(Steam).getUserSummaries(reportedSteamId64))?.avatar
				?.large ?? undefined;

		if (message.trim().length < 1) message = "No message provided..?";
		const embed = new Embed()
			.setAuthor(
				`${reportedNick} was reported`,
				reportedAvatar,
				`https://steamcommunity.com/profiles/${reportedSteamId64}`
			)
			.setDescription(
				`\`\`\`\n${Markup.escape.codeblock(message.substring(0, 1900))}\n\`\`\`
				SteamID64: ${reportedSteamId64}`
			)
			.setFooter(`by ${nick} (steamcommunity.com/profiles/${steamId64})`, avatar)
			.setColor(0xb54343);
		notificationsChannel.createMessage({
			content: callAdminRole && callAdminRole.mention,
			embed,
		});
	}
}
