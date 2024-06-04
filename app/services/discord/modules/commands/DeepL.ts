import { EphemeralResponse } from ".";
import { MenuCommand, SlashCommand } from "@/extensions/discord";
import Discord from "discord.js";
import QueryString from "qs";
import axios, { AxiosResponse } from "axios";
import config from "@/config/deepl.json";

const LANG = [
	"BG",
	"CS",
	"DA",
	"DE",
	"EL",
	"EN-GB",
	"EN-US",
	"EN",
	"ES",
	"ET",
	"FI",
	"FR",
	"HU",
	"IT",
	"JA",
	"LT",
	"LV",
	"NL",
	"PL",
	"PT-PT",
	"PT-BR",
	"PT",
	"RO",
	"RU",
	"SK",
	"SL",
	"SV",
	"TR",
	"UK",
	"ZH",
] as const;

type SupportedLanguages = (typeof LANG)[number];

interface DeeplResponse {
	translations: {
		detected_source_language: string;
		text: string;
	}[];
}
interface DeeplOptions {
	auth_key: string;
	text: string;
	source_lang?: SupportedLanguages;
	target_lang: SupportedLanguages;
	split_sentences?: "0" | "1" | "nonewlines";
	preserve_formatting?: "0" | "1";
	formality?: "default" | "more" | "less" | "prefer_more" | "prefer_less";
	glossary_id?: string;
}

async function translate(options: DeeplOptions): Promise<AxiosResponse<DeeplResponse>> {
	return axios.post("https://api-free.deepl.com/v2/translate", QueryString.stringify(options));
}

export const SlashDeeplCommand: SlashCommand = {
	options: {
		name: "deepl",
		description: "translate using DeepL.",
		options: [
			{
				name: "text",
				description: "text to translate",
				type: Discord.ApplicationCommandOptionType.String,
				required: true,
			},
			{
				name: "to",
				description: "language to translate to",
				type: Discord.ApplicationCommandOptionType.String,
				autocomplete: true,
			},
			{
				name: "from",
				description: "language to translate to",
				type: Discord.ApplicationCommandOptionType.String,
				autocomplete: true,
			},
			{
				name: "formal",
				description:
					"try to get a more formal version if possible for now (DE,FR,IT,ES,NL,PL,PT,RU)",
				type: Discord.ApplicationCommandOptionType.String,
				choices: [
					{ name: "more_formal", value: "prefer_more" },
					{ name: "less_formal", value: "prefer_less" },
				],
			},
		],
	},
	execute: async ctx => {
		const text = ctx.options.getString("text");
		if (text && Buffer.from(text).length < 128 * 1024) {
			const to = <SupportedLanguages>ctx.options.getString("to") ?? "EN";
			const from = <SupportedLanguages>ctx.options.getString("from");
			const formality =
				<DeeplOptions["formality"]>ctx.options.getString("formality") ?? "default";
			const res = await translate({
				auth_key: config.key,
				text: text,
				target_lang: to,
				source_lang: from,
				formality: formality,
			});
			if (res) {
				await ctx.reply(
					`**${res.data.translations[0].detected_source_language} -> ${to}${
						formality
							? ` (${formality === "prefer_more" ? "formal" : "less formal"})`
							: ""
					}**\`\`\`\n${res.data.translations[0].text}\`\`\``
				);
			} else {
				await ctx.reply("Something went wrong while trying to translate.");
			}
		} else {
			await ctx.reply("Text too big!");
		}
		// 	}
	},
	autocomplete: async ctx => {
		await ctx.respond(
			LANG.filter(
				function (entry) {
					if (this.limit < 25) {
						this.limit++;
						return entry.includes(ctx.options.getFocused().toUpperCase());
					}
				},
				{ limit: 0 }
			).map(lang => {
				return { name: lang, value: lang };
			})
		);
	},
};

export const MenuDeeplCommand: MenuCommand = {
	options: {
		name: "DeepL translate",
		type: Discord.ApplicationCommandType.Message,
	},
	execute: async (ctx: Discord.MessageContextMenuCommandInteraction) => {
		const msg = ctx.targetMessage;
		const text = msg.content;
		if (text && Buffer.from(text).length < 128 * 1024) {
			const res = await translate({
				auth_key: config.key,
				text: text,
				target_lang: "EN",
			});
			if (res) {
				const embed: Discord.APIEmbed = {
					author: {
						name: msg.author.username,
						icon_url: msg.author.displayAvatarURL(),
						url: `https://discord.com/channels/${ctx.guildId}/${msg.channelId}/${msg.id}`,
					},
					footer: {
						text: "DeepL translate",
						icon_url: "https://avatars.githubusercontent.com/u/83310993?s=200&v=4",
					},
					description: `
						\`\`\`\n${msg.content}\`\`\`\n**${res.data.translations[0].detected_source_language} -> EN**\n\`\`\`\n${res.data.translations[0].text}\`\`\``,
				};
				await ctx.reply({ embeds: [embed], ephemeral: true });
			} else {
				await ctx.reply(
					EphemeralResponse("Something went wrong while trying to translate.")
				);
			}
		} else {
			await ctx.reply(EphemeralResponse("Can't find text to translate or text is too big."));
		}
	},
};
