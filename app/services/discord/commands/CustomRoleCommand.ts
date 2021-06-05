import { CommandContext, CommandOptionType, SlashCommand, SlashCreator } from "slash-create";
import { DiscordBot } from "..";
import Discord from "discord.js";
import EphemeralResponse from ".";

const ROLE_IDENTIFIER = "\u2063";
export class SlashCustomRoleCommand extends SlashCommand {
	private bot: DiscordBot;

	constructor(bot: DiscordBot, creator: SlashCreator) {
		super(creator, {
			name: "role",
			description: "Gives you a Custom Role.",
			deferEphemeral: true,
			guildIDs: [bot.config.guildId],
			options: [
				{
					type: CommandOptionType.STRING,
					name: "name",
					description: "The name of your role",
					required: true,
				},
				{
					type: CommandOptionType.INTEGER,
					name: "red",
					description: "The red component of your color",
				},
				{
					type: CommandOptionType.INTEGER,
					name: "green",
					description: "The green component of your color",
				},
				{
					type: CommandOptionType.INTEGER,
					name: "blue",
					description: "The blue component of your color",
				},
			],
		});
		this.filePath = __filename;
		this.bot = bot;
	}

	async run(ctx: CommandContext): Promise<any> {
		const roleName = ctx.options.name + ROLE_IDENTIFIER;
		const r = ctx.options?.red?.toString() ?? "255",
			g = ctx.options?.green?.toString() ?? "255",
			b = ctx.options?.blue?.toString() ?? "255";
		const roleColor: Discord.ColorResolvable = [parseInt(r), parseInt(g), parseInt(b)];

		const guild = await this.bot.discord.guilds.resolve(ctx.guildID)?.fetch();
		if (!guild) {
			return EphemeralResponse("Not in a guild");
		}

		const roles = await guild.roles.fetch();
		const member = await guild.members.fetch(ctx.member.id);
		let targetRole = roles.cache.find(r => r.name === roleName);
		if (!targetRole) {
			// if we have an another existing role, remove it
			const existingRole = member.roles.cache.find(r => r.name.endsWith(ROLE_IDENTIFIER));
			if (existingRole) {
				await member.roles.remove(existingRole);
				if (existingRole.members.size === 0) {
					await existingRole.delete();
				}
			}

			targetRole = await roles.create({
				reason: "Role command",
				data: {
					name: roleName.toString(),
					color: roleColor,
				},
			});
		} else {
			await targetRole.setColor(roleColor, "Role command");
		}

		await member.roles.add(targetRole);

		return EphemeralResponse("Role added");
	}
}
