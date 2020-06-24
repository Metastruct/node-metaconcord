import * as requestSchema from "./structures/StatusRequest.json";
import { Embed } from "detritus-client/lib/utils";
import { StatusRequest } from "./structures";
import { request as WebSocketRequest } from "websocket";
import Payload from "./Payload";

export default class StatusPayload extends Payload {
	protected requestSchema = requestSchema;

	public async handle(
		req: WebSocketRequest,
		payload: StatusRequest
	): Promise<void> {
		this.validate(this.requestSchema, payload);

		const ip = req.httpRequest.connection.remoteAddress;
		const bot = this.gameBridge.getBot(ip, this.connection);
		const updateStatus = async () => {
			const count = payload.status.players.length;

			// Presence
			const status = {
				activity: {
					name: `${count} player${count != 1 ? "s" : ""}`,
					type: 2,
				},
				status: "online",
			};
			bot.client.gateway.setPresence(status);
			const guild = bot.client.guilds.get(this.gameBridge.config.guildId);
			const serverInfoChannel = bot.client.channels.get(
				this.gameBridge.config.serverInfoChannelId
			);

			// Nick
			/*
			const hostname = payload.status.hostname.match(
				/Meta Construct\s*.?.? - (.*)/i
			)[1];
			if (hostname) guild.me.editNick(hostname.substring(0, 32));
			*/
			guild.me.editNick(payload.status.map);

			// Permanent status message
			let desc = `:map: **Map**: \`${payload.status.map}\`
:busts_in_silhouette: **${count} player${count != 1 ? "s" : ""}**`;
			if (count > 0) {
				desc += `:
\`\`\`
${payload.status.players.join(", ")}
\`\`\``;
			} else {
				desc += "\n";
			}
			desc += `\nsteam://connect/${ip}`;
			const embed = new Embed().setDescription(desc).setColor(0x4bf5ca);
			const messages = await serverInfoChannel.fetchMessages({});
			const message = messages.filter(
				msg => msg.author.id == bot.client.user.id
			)[0];
			if (message) {
				message.edit({ embed });
			} else {
				serverInfoChannel.createMessage({ embed });
			}
		};

		if (bot.ran) {
			updateStatus();
		} else {
			bot.client.once("gatewayReady", () => {
				updateStatus();
			});
		}
	}
}
