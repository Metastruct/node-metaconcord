import * as Discord from "discord.js";
import { Container, Service } from "../Container.js";
import config from "@/config/irc.json" with { type: "json" };
import nIRC from "irc-upd";
import { logger } from "@/utils.js";

const log = logger(import.meta);

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
		url: `https://discord.com/api/v10/webhooks/${config.webhookId}/${config.webhookToken}`,
	});

	private async relayDiscord(nick: string, text: string, message: message) {
		if (nick.match(/meta\d/)) return;
		text = text === "" ? "<empty>" : text;
		await this.webhook
			.send({
				content: text,
				username: `[IRC] ${nick}`,
				avatarURL: `https://robohash.org/${nick}.png`,
				allowedMentions: { parse: ["users", "roles"] },
			})
			.catch(log.error.bind(log));
	}

	private relayIRC(text: string): void {
		this.client.say(config.relayIRCChannel, `\u000314[Discord]\u000f ${text}`);
	}

	private async setupDiscord() {
		const bot = await this.container.getService("DiscordBot");
		// Discord
		bot.discord.on("messageCreate", async msg => {
			if (msg.channelId === config.relayDiscordChannel) {
				if (msg.author.bot) return;
				msg = await bot.fetchPartial(msg);
				let content = msg.content;
				for (const [, attachment] of msg.attachments) {
					content += "\n" + attachment.url;
				}
				this.relayIRC(
					`\u000312${msg.author.username}${
						msg.reference && msg.reference.type === 0
							? ` (replying to ${(await msg.fetchReference()).author.username})`
							: ""
					}\u000f: ${content}`
				);
			}
		});
	}

	constructor(container: Container) {
		super(container);
		this.setupDiscord();
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

		this.client.on("error", err => log.error(err));
	}
}

export default (container: Container): Service => {
	return new IRC(container);
};
