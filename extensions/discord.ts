import { GuildMember, User } from "discord.js";

declare module "discord.js" {
	interface User {
		mention: string;
	}
	interface GuildMember {
		mention: string;
	}
}
Object.defineProperty(User.prototype, "mention", {
	get() {
		return `<@${this.id}>`;
	},
});
Object.defineProperty(GuildMember.prototype, "mention", {
	get() {
		return `<@${this.id}>`;
	},
});
