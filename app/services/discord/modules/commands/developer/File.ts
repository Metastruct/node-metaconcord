import * as Discord from "discord.js";
import { EphemeralResponse, SlashCommand } from "@/extensions/discord.js";
import { getOrFetchGmodFile } from "@/utils.js";

const PATH_MATCH = /(?<filename>[-_.A-Za-z0-9]+)\.(?<ext>[a-z]*)/g;

export const SlashFileCommand: SlashCommand = {
	options: {
		name: "file",
		description: "gets a file from #2",
		default_member_permissions: Discord.PermissionsBitField.Flags.ManageGuild.toString(),
		options: [
			{
				type: Discord.ApplicationCommandOptionType.String,
				name: "path",
				description:
					"full path of the file to fetch, for example lua/autorun/example.lua:4 (ranges also possible)",
				required: true,
			},
		],
	},

	async execute(ctx) {
		await ctx.deferReply();
		const path = ctx.options.getString("path", true);
		const [, filename, ext] = new RegExp(PATH_MATCH).exec(path) || [];
		const file = await getOrFetchGmodFile(path);
		if (!file) {
			ctx.followUp(EphemeralResponse("file not found :("));
			console.error(`SlashFile: file missing?`, ctx.user, path);
			return;
		}

		await ctx.followUp({
			files: [
				{
					attachment: Buffer.from(file),
					name: `${filename}.${ext}`,
				},
			],
		});
	},
};
