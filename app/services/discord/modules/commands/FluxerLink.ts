import { EphemeralResponse, SlashCommand } from "@/extensions/discord.js";

export const SlashFluxerLinkCommand: SlashCommand = {
	options: {
		name: "fluxer-link",
		description: "Link your Discord and Fluxer accounts for bridge mentions",
	},
	async execute(interaction, bot) {
		const fluxer = bot.container.getService("Fluxer");
		const { code } = await fluxer.createLinkCode(interaction.user.id);
		await interaction.reply(
			EphemeralResponse(
				`In any writable mirrored Fluxer channel, send:\n\n` +
					`\`METACONCORD_LINK ${code}\`\n\nThis code expires in 10 minutes and can only be used once.`
			)
		);
	},
};
