import * as Discord from "discord.js";
import config from "@/config/minecraft.json" with { type: "json" };

let chat: Discord.WebhookClient | undefined;

export const chatWebhook = (): Discord.WebhookClient =>
	(chat ??= new Discord.WebhookClient({ url: config.chatWebhookUrl }));
