import { CommandContext, CommandOptionType, SlashCreator } from "slash-create";
import { DiscordBot } from "@/app/services";
import { EphemeralResponse } from "..";
import { SlashDeveloperCommand } from "./DeveloperCommand";

export class SlashSQLCommand extends SlashDeveloperCommand {
	constructor(bot: DiscordBot, creator: SlashCreator) {
		super(bot, creator, {
			name: "sql",
			description: "Executes an SQL query",
			options: [
				{
					type: CommandOptionType.STRING,
					name: "query",
					description: "The SQL query to execute",
					required: true,
				},
				{
					type: CommandOptionType.STRING,
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
					required: true,
				},
			],
		});

		this.filePath = __filename;
		this.bot = bot;
	}

	private async sendResult(ctx: CommandContext, result: unknown) {
		await ctx.send({
			file: {
				file: Buffer.from(JSON.stringify(result, null, 2), "utf-8"),
				name: "sql_result.json",
			},
		});
	}
	public async runProtected(ctx: CommandContext): Promise<any> {
		try {
			switch (ctx.options.target) {
				case "metaconcord": {
					if (!this.bot.isElevatedUser(ctx.user.id))
						return EphemeralResponse(
							`You need the <@&${this.bot.config.elevatedRoleId}> role to run SQL commands on me!`
						);
					const sql = this.bot.container.getService("SQL");
					if (sql) {
						const db = await sql?.getLocalDatabase();
						const res = await db?.all(ctx.options.query);
						await this.sendResult(ctx, res);
					} else {
						return EphemeralResponse("SQL service not running");
					}

					break;
				}
				case "metastruct": {
					const sql = this.bot.container.getService("SQL");
					if (sql) {
						const res = await sql.queryPool(ctx.options.query);
						await this.sendResult(ctx, res);
					} else {
						return EphemeralResponse("SQL service not running");
					}
					break;
				}
				default:
					await ctx.send("Unsupported or un-implemented target");
					break;
			}
		} catch (err) {
			await ctx.send(err.message);
		}
	}
}
