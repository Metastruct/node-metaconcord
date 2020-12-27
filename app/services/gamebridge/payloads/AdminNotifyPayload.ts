import * as requestSchema from "./structures/AdminNotifyRequest.json";
import { AdminNotifyRequest } from "./structures";
import { Embed, Markup } from "detritus-client/lib/utils";
import { Role } from "detritus-client/lib/structures";
import { Steam } from "../../Steam";
import { request as WebSocketRequest } from "websocket";
import Payload from "./Payload";
import SteamID from "steamid";
import app from "@/app";

export default class AdminNotifyPayload extends Payload {
	protected requestSchema = requestSchema;

	async handle(req: WebSocketRequest, payload: AdminNotifyRequest): Promise<void> {
		this.validate(this.requestSchema, payload);
		const bridge = this.server.bridge;
		const discordClient = this.server.discord.client;

		const { nick, reportedNick, steamId, reportedSteamId } = payload;
		let message = payload.message;

		const callAdminRole = (
			await discordClient.rest.fetchGuildRoles(bridge.config.guildId)
		).find((role: Role) => role.id == bridge.config.callAdminRoleId);
		const notificationsChannel = await discordClient.rest.fetchChannel(
			bridge.config.notificationsChannelId
		);

		const steamId64 = new SteamID(steamId).getSteamID64();
		const reportedSteamId64 = new SteamID(reportedSteamId).getSteamID64();

		// Grab player avatars
		const steam = app.container.getService(Steam);
		const avatar = (await steam.getUserSummaries(steamId64))?.avatar?.large ?? undefined;
		const reportedAvatar =
			(await steam.getUserSummaries(reportedSteamId64))?.avatar?.large ?? undefined;

		if (message.trim().length < 1) message = "No message provided..?";
		const embed = new Embed()
			.setAuthor(
				`${reportedNick} was reported`,
				reportedAvatar,
				`https://steamcommunity.com/profiles/${reportedSteamId64}`
			)
			.setDescription(
				`\`\`\`\n${Markup.escape.codeblock(message.substring(0, 1900))}\n\`\`\`` +
					`SteamID64: ${reportedSteamId64}`
			)
			.setFooter(`by ${nick} (steamcommunity.com/profiles/${steamId64})`, avatar)
			.setColor(0xb54343);
		notificationsChannel.createMessage({
			content: callAdminRole && callAdminRole.mention,
			embed,
		});
	}
}
