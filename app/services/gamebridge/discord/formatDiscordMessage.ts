import * as Discord from "discord.js";

const MEDIA_URL = /https?:\/\/(?:media|cdn)\.discordapp\.(?:net|com)\/attachments\/\d+\/\d+\/\S+/;

export async function formatDiscordMessage(
	msg: Discord.Message | Discord.MessageSnapshot
): Promise<{
	content: string;
	username?: string;
	nickname: string;
	avatar?: string;
	color: number;
}> {
	let content = msg.content;
	content = content.replace(/<(a?):[^\s:<>]*:(\d+)>/g, (_, animated, id) => {
		const extension = !animated ? "gif" : "png";
		return `https://media.discordapp.net/emojis/${id}.${extension}?v=1&size=64 `;
	});
	content = content.replace(
		/<#([\d]+)>/g,
		(_, id) =>
			`#${
				msg.guild?.channels.cache.has(id)
					? (msg.guild.channels.cache.get(id) as Discord.TextChannel).name
					: "(uncached channel)"
			}`
	);
	content = content.replace(
		/<@!?(\d+)>/g,
		(_, id) =>
			`@${
				msg.guild?.members.cache.has(id)
					? (msg.guild.members.cache.get(id) as Discord.GuildMember).displayName
					: "(uncached user)"
			}`
	);
	content = content.replace(/(https?:\/\/tenor.com\/view\/\S+)/g, (_, url) => url + ".gif");

	for (const [, attachment] of msg.attachments) {
		content += (content.length > 0 ? "\n" : "") + attachment.url;
	}
	for (const [, sticker] of msg.stickers) {
		content += (content.length > 0 ? "\n" : "") + sticker.url;
	}

	// workaround for getting the thumbnail with expiry, so it's visible ingame
	const media = content.match(MEDIA_URL);
	if (media) {
		const thumbnail = msg.embeds.find(e => e.thumbnail?.url.match(media[0]))?.thumbnail;
		if (thumbnail) {
			content = content.replace(MEDIA_URL, thumbnail.url);
		}
	}

	if (content.length === 0 && !msg.messageSnapshots) {
		// no content, stickers or attachments, so it must be an embed or components
		// at this point it's better to just check on discord what the message was.
		if (msg.embeds.length > 0) {
			content += "[Embed]";
		} else {
			content += "[Something]";
		}
	}

	const username = msg.author?.username;
	let nickname = "";
	let avatar: string | undefined = undefined;
	const color = msg.member?.displayColor ?? 0;

	if (msg.author) {
		try {
			const author = await msg.guild?.members.fetch(msg.author.id);
			if (author && author.nickname && author.nickname.length > 0) {
				nickname = author.nickname;
			}
		} catch {}

		const avatarhash = msg.author.avatar;
		avatar = avatarhash
			? `https://cdn.discordapp.com/avatars/${msg.author.id}/${avatarhash}${
					avatarhash.startsWith("a_") ? ".gif" : ".png"
				}`
			: msg.author.defaultAvatarURL;
	}

	return {
		content,
		username,
		nickname,
		avatar,
		color,
	};
}
