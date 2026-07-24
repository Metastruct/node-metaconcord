import * as Discord from "discord.js";
import config from "@/config/gmod.json" with { type: "json" };

export const chatWebhook = new Discord.WebhookClient({ url: config.chatWebhookUrl });
export const errorWebhook = new Discord.WebhookClient({ url: config.errorWebhookUrl });
export const pacErrorWebhook = new Discord.WebhookClient({ url: config.pacErrorWebhookUrl });
