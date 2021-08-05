import { CommandContext, CommandOptionType, SlashCreator } from "slash-create";
import { DiscordBot } from "@/app/services";
import { SlashDeveloperCommand } from "./DeveloperCommand";

export class SlashSqlCommand extends SlashDeveloperCommand {
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
							name: "3k",
							value: "3k",
						},
					],
					required: true,
				},
			],
		});

		this.filePath = __filename;
		this.bot = bot;
	}

	public async runProtected(ctx: CommandContext): Promise<any> {
		try {
			switch (ctx.options.target) {
				case "metaconcord":
					const sql = this.bot.container.getService("Sql");
					const db = await sql.getDatabase();
					const res = await db.all(ctx.options.query);

					await ctx.send({
						file: {
							file: Buffer.from(JSON.stringify(res), "utf-8"),
							name: "sql_result.txt",
						},
					});
					break;
				default:
					await ctx.send("Unsupported or un-implemented target");
					break;
			}
		} catch (err) {
			await ctx.send(err.message);
		}
	}
}
