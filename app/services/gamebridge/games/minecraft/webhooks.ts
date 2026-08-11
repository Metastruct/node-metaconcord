import * as Discord from "discord.js";
import config from "@/config/minecraft.json" with { type: "json" };

export const chatWebhook = new Discord.WebhookClient({ url: config.chatWebhookUrl });
