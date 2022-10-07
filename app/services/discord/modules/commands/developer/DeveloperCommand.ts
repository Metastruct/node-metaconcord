import {
	CommandContext,
	SlashCommand,
	SlashCommandOptions,
	SlashCreator,
	User,
} from "slash-create";
import { DiscordBot } from "@/app/services";
import { EphemeralResponse } from "..";
import { GameServer, Player } from "@/app/services/gamebridge";
import { Rule } from "../../..";
import SteamID from "steamid";

export class SlashDeveloperCommand extends SlashCommand {
	protected bot: DiscordBot;

	constructor(
		bot: DiscordBot,
		creator: SlashCreator,
		{ name, description, deferEphemeral, options, throttling, unknown }: SlashCommandOptions
	) {
		super(creator, {
			name,
			description,
			deferEphemeral,
			guildIDs: [bot.config.guildId],
			forcePermissions: true,
			options,
			requiredPermissions: ["MANAGE_ROLES"],
			throttling,
			unknown,
		});

		this.filePath = __filename;
		this.bot = bot;
	}

	private async isAllowed(user: User): Promise<boolean> {
		try {
			const guild = await this.bot.discord.guilds.fetch(this.bot.config.guildId);
			if (!guild) return false;

			const member = await guild.members.fetch(user.id);
			if (!member) return false;

			return member.roles.cache.has(this.bot.config.developerRoleId);
		} catch {
			return false;
		}
	}

	public async getPlayers(server: number): Promise<GameServer["status"]["players"] | undefined> {
		const bridge = this.bot.container.getService("GameBridge");
		if (!bridge) return;
		const where = server ?? 2;
		if (!bridge.servers[where]) return;
		return bridge.servers[where].status.players;
	}

	public async getPlayer(steamID64: string, server?: number): Promise<Player | undefined> {
		const bridge = this.bot.container.getService("GameBridge");
		if (!bridge) return;
		const accountId = SteamID.fromIndividualAccountID(steamID64).accountid;
		if (server) {
			if (!bridge.servers[server]) return;
			return bridge.servers[server].status.players.find(
				player => player.accountId === accountId
			);
		} else {
			const server = bridge.servers.find(server =>
				server.status.players.find(player => player.accountId === accountId)
			);
			if (server) return server.status.players.find(player => player.accountId === accountId);
			return;
			// there has to be an online for this right?????
		}
	}

	public async getRules(): Promise<Array<Rule>> {
		const data = this.bot.container.getService("Data");
		return data?.rules ?? [];
	}

	public async saveRules(rules: Array<Rule>): Promise<void> {
		const data = this.bot.container.getService("Data");
		if (data) {
			data.rules = rules;
			await data.save();
		}
	}

	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	protected async runProtected(ctx: CommandContext): Promise<any> {
		throw new Error("runProtected is not defined");
	}

	public async run(ctx: CommandContext): Promise<any> {
		await ctx.defer(true);

		if (!this.isAllowed(ctx.user)) {
			return EphemeralResponse("You are not allowed to use this command.");
		}

		return this.runProtected(ctx);
	}
}
