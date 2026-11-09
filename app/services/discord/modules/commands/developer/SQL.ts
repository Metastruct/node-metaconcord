import * as Discord from "discord.js";
import { sql } from "kysely";

import { EphemeralResponse, type SlashCommand } from "#extensions/discord.js";
import { errToMessage, jsonKyselify } from "#utils";

const makeFile = (content: unknown) => {
	return <Discord.BaseMessageOptions>{
		files: [
			{
				attachment: Buffer.from(jsonKyselify(content, 2), "utf8"),
				name: "sql_result.json",
			},
		],
	};
};

export const SlashSQLCommand: SlashCommand = {
	options: {
		name: "sql",
		description: "Executes an SQL query",
		default_member_permissions: "0",
		options: [
			{
				type: Discord.ApplicationCommandOptionType.String,
				name: "query",
				description: "The SQL query to execute",
				required: true,
			},
			{
				type: Discord.ApplicationCommandOptionType.String,
				name: "target",
				description: "The target SQL db to run the query on",
				choices: [
					{
						name: "metaconcord",
						value: "metaconcord",
					},
					{
						name: "metastruct",
						value: "metastruct",
					},
				],
			},
		],
	},
	execute: async (ctx, bot) => {
		const target = ctx.options.getString("target");
		const query = ctx.options.getString("query", true);
		if (!ctx.member) {
			await ctx.reply(EphemeralResponse("if this happens ping @techbot"));
			return;
		}
		try {
			switch (target) {
				case "metaconcord": {
					if (
						!(<Discord.GuildMemberRoleManager>ctx.member.roles).cache.has(
							bot.config.roles.elevated
						)
					) {
						await ctx.reply(
							EphemeralResponse(
								`You need the <@&${bot.config.roles.elevated}> role to run SQL commands on me!`
							)
						);
						return;
					}
					await ctx.deferReply();
					const db = bot.container.getService("LocalDB")?.db;
					const res = db ? await sql.raw(query).execute(db) : undefined;
					const file = makeFile(res);
					await ctx.followUp(file);
					break;
				}

				default: {
					await ctx.deferReply();
					const res = await bot.container.getService("RemoteDB").query(query);
					const file = makeFile(res);
					await ctx.followUp(file);

					break;
				}
			}
		} catch (error: unknown) {
			if (ctx.deferred) {
				await ctx.followUp(errToMessage(error));
			} else {
				await ctx.reply(EphemeralResponse(errToMessage(error)));
			}
		}
	},
};
