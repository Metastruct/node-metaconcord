import { DiscordBot } from "..";
import Discord from "discord.js";

function isEmpty(obj: { [roleId: string]: { adderId: string; timeStamp: number } }) {
	for (const _roleId in obj) {
		return false;
	}
	return true;
}

export default async (bot: DiscordBot): Promise<void> => {
	const data = bot.container.getService("Data");
	if (!data) return;
	const permaRoles = data.permaRoles;
	const permaPrefix = "#";

	bot.discord.on("guildMemberUpdate", async (outdated, updated) => {
		outdated = outdated.partial ? await bot.fetchPartial(outdated) : outdated;
		updated = updated.partial ? await bot.fetchPartial(updated) : updated;

		const removedRoles = outdated.roles.cache.filter(role => !updated.roles.cache.has(role.id));
		const addedRoles = updated.roles.cache.filter(role => !outdated.roles.cache.has(role.id));
		if (!removedRoles && !addedRoles) return;

		const addedPermaRoles = addedRoles.filter(role => role.name.charAt(0) === permaPrefix);
		const removedPermaRoles = removedRoles.filter(role => role.name.charAt(0) === permaPrefix);

		if (addedPermaRoles.size === 0 && removedPermaRoles.size === 0) return;

		const auditLogs = await updated.guild.fetchAuditLogs({
			type: Discord.AuditLogEvent.MemberRoleUpdate,
			limit: 1,
		});
		const lastLog = auditLogs.entries.first();
		if (!lastLog || lastLog.executorId === null) {
			console.error("[perma-roles] wtf:", lastLog);
			return;
		}
		const adderId = lastLog.executorId;

		for (const role of addedPermaRoles) {
			if (!permaRoles[updated.id]) {
				permaRoles[updated.id] = {
					roles: { [role[0]]: { adderId: adderId, timeStamp: Date.now() } },
				};
			} else {
				permaRoles[updated.id].roles[role[0]] = { adderId: adderId, timeStamp: Date.now() };
			}
		}

		for (const role of removedPermaRoles) {
			if (!permaRoles[updated.id]) return;
			if (permaRoles[updated.id].roles[role[0]]) delete permaRoles[updated.id].roles[role[0]];
		}

		if (permaRoles[updated.id] && isEmpty(permaRoles[updated.id].roles)) {
			delete permaRoles[updated.id];
		}
		data.save();
	});

	bot.discord.on("guildMemberAdd", async member => {
		if (permaRoles[member.id]) {
			const { roles } = permaRoles[member.id];
			member.roles.add(
				Object.entries(roles).map(entry => entry[0]), // kinda weird but I guess that works?
				"adding back perma roles"
			);
		}
	});
};
