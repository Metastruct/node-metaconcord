import { EphemeralResponse } from "..";
import { SlashCommand } from "@/extensions/discord";
import Discord from "discord.js";

const makeFile = (content: unknown) => {
	return <Discord.BaseMessageOptions>{
		files: [
			{
				attachment: Buffer.from(JSON.stringify(content, null, 2), "utf-8"),
				name: "sql_result.json",
			},
		],
	};
};

export const SlashSQLCommand: SlashCommand = {
	options: {
		name: "sql",
		description: "Executes an SQL query",
		default_member_permissions: Discord.PermissionsBitField.Flags.ManageGuild.toString(),
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
		const sql = bot.container.getService("SQL");
		if (!ctx.member) {
			await ctx.reply(EphemeralResponse("if this happens ping @techbot"));
			console.error("SlashSQL: WTF");
			return;
		}
		try {
			switch (target) {
				case "metaconcord": {
					if (
						!(<Discord.GuildMemberRoleManager>ctx.member.roles).cache.has(
							bot.config.roles.elevated
						)
					)
						await ctx.reply(
							EphemeralResponse(
								`You need the <@&${bot.config.roles.elevated}> role to run SQL commands on me!`
							)
						);
					if (sql) {
						await ctx.deferReply();
						const db = await sql?.getLocalDatabase();
						const res = await db?.all(query);
						const file = makeFile(res);
						await ctx.followUp(file);
					} else {
						await ctx.reply(EphemeralResponse("SQL service not running"));
					}
					break;
				}
				case "metastruct":
				default:
					if (sql) {
						await ctx.deferReply();
						const res = await sql.queryPool(query);
						const file = makeFile(res);
						await ctx.followUp(file);
					} else {
						await ctx.reply(EphemeralResponse("SQL service not running"));
					}
					break;
			}
		} catch (err) {
			if (ctx.deferred) {
				await ctx.followUp(err.message);
			} else {
				await ctx.reply(EphemeralResponse(err.message));
			}
		}
	},
};
