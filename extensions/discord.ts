import Discord from "discord.js";

declare module "discord.js" {
	interface User {
		mention: string;
	}
	interface GuildMember {
		mention: string;
		hasCustomRole: boolean;
		getCustomRole: Discord.Role;
	}
}
Object.defineProperty(Discord.User.prototype, "mention", {
	get(this: Discord.GuildMember) {
		return `<@${this.id}>`;
	},
});
Object.defineProperty(Discord.GuildMember.prototype, "mention", {
	get(this: Discord.GuildMember) {
		return `<@${this.id}>`;
	},
});
Object.defineProperty(Discord.GuildMember.prototype, "hasCustomRole", {
	get(this: Discord.GuildMember) {
		return this.roles.cache.some(role => role.name.endsWith("\u2063"));
	},
});
Object.defineProperty(Discord.GuildMember.prototype, "getCustomRole", {
	get(this: Discord.GuildMember) {
		return this.roles.cache.find(role => role.name.endsWith("\u2063"));
	},
});
