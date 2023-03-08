import { DiscordBot } from "@/app/services";
import { EphemeralResponse } from "..";
import { SlashCreator } from "slash-create";
import { SlashDeveloperCommand } from "./DeveloperCommand";

export class SlashForceIotdRerollCommand extends SlashDeveloperCommand {
	constructor(bot: DiscordBot, creator: SlashCreator) {
		super(bot, creator, {
			name: "force-iotd-reroll",
			description: "Force reroll Iotd for convenience",
			deferEphemeral: true,
		});

		this.filePath = __filename;
		this.bot = bot;
	}

	public async runExtraProtected(): Promise<any> {
		try {
			const lastmsg = await this.bot.getLastMotdMsg();
			if (!lastmsg) return EphemeralResponse("Could not find last message");
			if (!lastmsg.content.includes("Image of the day"))
				return EphemeralResponse("Last message isn't an iotd");
			await this.bot.container.getService("Motd")?.rerollImageJob();
			return EphemeralResponse("👍");
		} catch (err) {
			return EphemeralResponse("Error: " + err);
		}
	}
}
