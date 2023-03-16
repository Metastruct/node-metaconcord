import { CommandContext, CommandOptionType, SlashCommand, SlashCreator } from "slash-create";
import { Data } from "@/app/services/Data";
import { DiscordBot } from "../..";
import { EphemeralResponse } from ".";
import Discord from "discord.js";

export class SlashTempVoiceChannelCommand extends SlashCommand {
	bot: DiscordBot;
	data: Data;
	pending: string[];
	constructor(bot: DiscordBot, creator: SlashCreator) {
		super(creator, {
			name: "voice",
			description: "Voice Chat commands",
			deferEphemeral: true,
			guildIDs: [bot.config.bot.primaryGuildId],
			options: [
				{
					type: CommandOptionType.SUB_COMMAND,
					name: "create",
					description:
						"Creates a Voice Channel just for you! Removes itself if you leave.",
					options: [
						{
							type: CommandOptionType.STRING,
							name: "name",
							description: "Name of the Channel",
							required: true,
						},
					],
				},
			],
		});
		this.filePath = __filename;
		this.bot = bot;
		const data = bot.container.getService("Data");
		if (!data) return;
		this.data = data;
		this.pending = [];
	}

	async run(ctx: CommandContext): Promise<any> {
		const existing = this.data.tempVoiceChannels[ctx.user.id];
		if (existing)
			return EphemeralResponse(`You already created a channel... (<#${existing.channelId}>)`);
		if (this.pending.includes(ctx.user.id))
			return EphemeralResponse(`please wait 30 seconds before using this command again`);
		try {
			const channel = await this.bot.getGuild()?.channels.create({
				name: ctx.options.create.name,
				type: Discord.ChannelType.GuildVoice,
				parent: this.bot.config.categories.voiceChat,
				permissionOverwrites: [
					{ id: ctx.user.id, allow: ["ManageChannels", "ManageRoles"] },
				],
				reason: "temp channel command",
			});
			if (channel) {
				this.pending.push(ctx.user.id);
				setTimeout(async () => {
					const updatedChannel = (await this.bot
						.getGuild()
						?.channels.fetch(channel.id)) as Discord.VoiceChannel;
					if (updatedChannel?.members.size === 0) {
						await updatedChannel.delete("No one joined after 30 secs");
					} else {
						this.data.tempVoiceChannels[ctx.user.id] = {
							createdAt: Date.now(),
							channelId: channel.id,
						};
					}
					await this.data.save();
					this.pending.splice(this.pending.indexOf(ctx.user.id), 1);
				}, 1000 * 30);
				return EphemeralResponse(
					`Channel ${channel.toString()} created successfully, join within 30 secs or it will be deleted!`
				);
			}
		} catch (err) {
			console.error(err);
			return EphemeralResponse(
				"Something went wrong while creating the channel.\nDiscord probably didn't like your channel name."
			);
		}
	}
}
