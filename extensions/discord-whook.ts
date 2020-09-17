import { Webhook } from "discord-whook.js";
import fetch from "node-fetch";

Webhook.prototype.send = function (
	content = undefined,
	username = undefined,
	avatarURL = undefined,
	embed = [],
	allowedMentions = []
) {
	if (!content && embed.length === 0) {
		throw new Error("Cannot send an empty message!");
	}

	return new Promise(async () => {
		await fetch(`https://discordapp.com/api/webhooks/${this.webhookID}/${this.webhookToken}`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				content: content,
				username: username,
				avatar_url: avatarURL,
				embeds: embed,
				allowed_mentions: allowedMentions,
			}),
		}).catch(error => {
			throw new Error(`Webhook sending error: ${error}`);
		});
	});
};
