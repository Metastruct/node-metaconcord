import * as Discord from "discord.js";
import { EphemeralResponse, SlashCommand } from "@/extensions/discord.js";

const pending: string[] = [];

export const SlashVoiceCommand: SlashCommand = {
	options: {
		name: "voice",
		description: "Voice Chat commands",
		options: [
			{
				type: Discord.ApplicationCommandOptionType.Subcommand,
				name: "create",
				description: "Creates a Voice Channel just for you! Removes itself if you leave.",
				options: [
					{
						type: Discord.ApplicationCommandOptionType.String,
						name: "name",
						description: "Name of the Channel",
						required: true,
					},
				],
			},
		],
	},

	async execute(ctx, bot) {
		const data = await bot.container.getService("Data");

		const existing = data.tempVoiceChannels[ctx.user.id];
		if (existing) {
			await ctx.reply(
				EphemeralResponse(`You already created a channel... (<#${existing.channelId}>)`)
			);
			return;
		}

		if (pending.includes(ctx.user.id)) {
			await ctx.reply(
				EphemeralResponse(`please wait 30 seconds before using this command again`)
			);
			return;
		}

		await ctx.deferReply({ flags: Discord.MessageFlags.Ephemeral });

		try {
			const channel = await bot.getGuild()?.channels.create({
				name: ctx.options.getString("name", true),
				type: Discord.ChannelType.GuildVoice,
				parent: bot.config.categories.voiceChat,
				reason: `temp channel command from <@${ctx.user.id}> (${ctx.user.id})`,
			});
			if (channel) {
				await channel.edit({
					permissionOverwrites: [
						{ id: ctx.user.id, allow: ["ManageChannels", "ManageRoles"] },
					],
				});
				pending.push(ctx.user.id);
				setTimeout(async () => {
					const updatedChannel = (await bot
						.getGuild()
						?.channels.fetch(channel.id)) as Discord.VoiceChannel;
					if (updatedChannel?.members.size === 0) {
						await updatedChannel.delete("No one joined after 30 secs");
					} else {
						data.tempVoiceChannels[ctx.user.id] = {
							createdAt: Date.now(),
							channelId: channel.id,
						};
					}
					await data.save();
					pending.splice(pending.indexOf(ctx.user.id), 1);
				}, 1000 * 30);
				await ctx.followUp(
					EphemeralResponse(
						`Channel ${channel.toString()} created successfully, join within 30 secs or it will be deleted!`
					)
				);
			}
		} catch (err) {
			console.error(err);
			await ctx.followUp(
				EphemeralResponse(
					"Something went wrong while creating the channel.\nDiscord probably didn't like your channel name."
				)
			);
		}
	},
};
