import * as Discord from "discord.js";
import config from "@/config/gmod.json" with { type: "json" };

let chat: Discord.WebhookClient | undefined;
let error: Discord.WebhookClient | undefined;
let pacError: Discord.WebhookClient | undefined;

export const chatWebhook = (): Discord.WebhookClient =>
	(chat ??= new Discord.WebhookClient({ url: config.chatWebhookUrl }));

export const errorWebhook = (): Discord.WebhookClient =>
	(error ??= new Discord.WebhookClient({ url: config.errorWebhookUrl }));

export const pacErrorWebhook = (): Discord.WebhookClient =>
	(pacError ??= new Discord.WebhookClient({ url: config.pacErrorWebhookUrl }));
