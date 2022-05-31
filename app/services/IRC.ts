import { Container } from "../Container";
import { Service } from ".";
import Discord from "discord.js";
import config from "@/config/irc.json";
import nIRC from "irc-upd";

type message = {
	prefix: string;
	nick: string;
	user: string;
	host: string;
	server: string;
	rawCommand: string;
	command: string;
	commandType: ["normal", "error", "reply"];
	args: string[];
};

export class IRC extends Service {
	name = "IRC";
	client = new nIRC.Client(config.host, config.nick, {
		port: config.port,
		password: config.password,
		userName: config.username,
		realName: config.realname,
		channels: config.channels,
		autoRejoin: true,
		autoRenick: true,
		sasl: true,
		secure: true,
		stripColors: true,
	});

	private webhook = new Discord.WebhookClient({
		id: config.webhookId,
		token: config.webhookToken,
	});

	private async relayDiscord(nick: string, text: string, message: message) {
		if (nick.match(/meta\d/)) return;
		await this.webhook
			.send({
				content: text,
				username: `[IRC] ${nick}`,
				avatarURL: `https://robohash.org/${nick}.png`,
				allowedMentions: { parse: ["users", "roles"] },
			})
			.catch(console.error);
	}
	constructor(container: Container) {
		super(container);
		const bot = this.container.getService("DiscordBot");

		// discord
		bot.discord.on("messageCreate", async msg => {
			if (msg.channelId === config.relayDiscordChannel) {
				if (msg.author.discriminator === "0000") return;
				if (msg.author.bot) return;
				msg = await bot.fetchPartial(msg);
				let content = msg.content;
				for (const [, attachment] of msg.attachments) {
					content += "\n" + attachment.url;
				}
				let reply: Discord.Message;
				if (msg.reference) {
					reply = await msg.fetchReference();
				}
				this.relayIRC(
					`\u000312${msg.author.username}${
						msg.reference ? ` (replying to ${reply.author.username})` : ""
					}\u000f: ${content}`
				);
			}
		});
		// IRC
		this.client.on("registered", () => {
			this.client.say("NICKSERV", `IDENTIFY ${config.nick} ${config.password}`);
		});
		this.client.on(
			`message${config.relayIRCChannel}`,
			async (from: string, text: string, message: message) => {
				await this.relayDiscord(from, text, message);
			}
		);

		this.client.on("error", msg => console.error(msg));
	}
	private relayIRC(text: string): void {
		this.client.say(config.relayIRCChannel, `\u000314[Discord]\u000f ${text}`);
	}
}

export default (container: Container): Service => {
	return new IRC(container);
};
