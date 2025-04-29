import * as Discord from "discord.js";
import { EphemeralResponse, SlashCommand } from "@/extensions/discord.js";
import { makeSpeechBubble } from "@/utils.js";

export const SlashSpeechbubbleCommand: SlashCommand = {
	options: {
		name: "speechbubble",
		description: "create your own speechbubble gifs",
		options: [
			{
				type: Discord.ApplicationCommandOptionType.String,
				name: "link",
				description: "image link",
			},
			{
				type: Discord.ApplicationCommandOptionType.Attachment,
				name: "image",
				description: "file on your device",
			},
			{
				type: Discord.ApplicationCommandOptionType.Integer,
				name: "direction",
				description: "tail direction",
				choices: [
					{ name: "left", value: 0 },
					{ name: "right", value: 1 },
				],
			},
			{
				type: Discord.ApplicationCommandOptionType.String,
				name: "fill_color",
				description:
					"CSS style color for the speech bubble (default = transparent example: rgba(255,0,0,0.5))",
			},
			{
				type: Discord.ApplicationCommandOptionType.String,
				name: "line_color",
				description:
					"CSS style color for the speech bubble outline (default = transparent example: rgba(255,0,0,0.5))",
			},
			{
				type: Discord.ApplicationCommandOptionType.Number,
				name: "line_width",
				description: "how thicc the line is (default = 4)",
			},
		],
	},

	async execute(ctx) {
		const link = ctx.options.getString("link");
		const image = ctx.options.getAttachment("image");
		if (link && image) {
			await ctx.reply(EphemeralResponse("can't do shit with both, either one or the other"));
			return;
		}
		if (!link && !image) {
			await ctx.reply(EphemeralResponse("I can't read your mind, specify a file or link"));
			return;
		}
		if (link && !link.match(/^https?:\/\/.+\..+$/g)) {
			await ctx.reply(EphemeralResponse("link seems to be invalid"));
			return;
		}
		await ctx.deferReply();
		try {
			const attachment = image;
			const buffer = await makeSpeechBubble(
				link ? link : attachment?.url ?? "",
				ctx.options.getInteger("direction") === 1 ? true : false,
				<string>ctx.options.getString("fill_color"),
				<string>ctx.options.getString("line_color"),
				<number>ctx.options.getNumber("line_width")
			);
			await ctx.followUp({
				files: [{ attachment: buffer, name: "funny.gif" }],
			});
		} catch (err) {
			await ctx.followUp(EphemeralResponse(`something went wrong! (${err})`));
		}
	},
};

const getLink = (msg: Discord.Message) => {
	const sticker = msg.stickers.first();

	return sticker
		? sticker.format < 3
			? `https://cdn.discordapp.com/stickers/${sticker.id}.png`
			: sticker.format === 4
			? `https://cdn.discordapp.com/stickers/${sticker.id}.gif`
			: undefined
		: msg.content.match(/^https?:\/\/.+\..+$/g)
		? msg.content
		: msg.attachments.size > 0
		? msg.attachments.first()?.url
		: undefined;
};
