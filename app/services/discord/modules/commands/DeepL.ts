import * as Discord from "discord.js";
import { EphemeralResponse, MenuCommand, SlashCommand } from "@/extensions/discord.js";
import config from "@/config/deepl.json" with { type: "json" };

const SourceLanguages = [
	{ language: "AF", name: "Afrikaans" },
	{ language: "AN", name: "Aragonese" },
	{ language: "AR", name: "Arabic" },
	{ language: "AS", name: "Assamese" },
	{ language: "AY", name: "Aymara" },
	{ language: "AZ", name: "Azerbaijani" },
	{ language: "BA", name: "Bashkir" },
	{ language: "BE", name: "Belarusian" },
	{ language: "BG", name: "Bulgarian" },
	{ language: "BN", name: "Bengali" },
	{ language: "BR", name: "Breton" },
	{ language: "BS", name: "Bosnian" },
	{ language: "CA", name: "Catalan" },
	{ language: "CS", name: "Czech" },
	{ language: "CY", name: "Welsh" },
	{ language: "DA", name: "Danish" },
	{ language: "DE", name: "German" },
	{ language: "EL", name: "Greek" },
	{ language: "EN", name: "English" },
	{ language: "EO", name: "Esperanto" },
	{ language: "ES", name: "Spanish" },
	{ language: "ET", name: "Estonian" },
	{ language: "EU", name: "Basque" },
	{ language: "FA", name: "Persian" },
	{ language: "FI", name: "Finnish" },
	{ language: "FR", name: "French" },
	{ language: "GA", name: "Irish" },
	{ language: "GL", name: "Galician" },
	{ language: "GN", name: "Guarani" },
	{ language: "GU", name: "Gujarati" },
	{ language: "HA", name: "Hausa" },
	{ language: "HE", name: "Hebrew" },
	{ language: "HI", name: "Hindi" },
	{ language: "HR", name: "Croatian" },
	{ language: "HT", name: "Haitian Creole" },
	{ language: "HU", name: "Hungarian" },
	{ language: "HY", name: "Armenian" },
	{ language: "ID", name: "Indonesian" },
	{ language: "IG", name: "Igbo" },
	{ language: "IS", name: "Icelandic" },
	{ language: "IT", name: "Italian" },
	{ language: "JA", name: "Japanese" },
	{ language: "JV", name: "Javanese" },
	{ language: "KA", name: "Georgian" },
	{ language: "KK", name: "Kazakh" },
	{ language: "KO", name: "Korean" },
	{ language: "KY", name: "Kyrgyz" },
	{ language: "LA", name: "Latin" },
	{ language: "LB", name: "Luxembourgish" },
	{ language: "LN", name: "Lingala" },
	{ language: "LT", name: "Lithuanian" },
	{ language: "LV", name: "Latvian" },
	{ language: "MG", name: "Malagasy" },
	{ language: "MI", name: "Maori" },
	{ language: "MK", name: "Macedonian" },
	{ language: "ML", name: "Malayalam" },
	{ language: "MN", name: "Mongolian" },
	{ language: "MR", name: "Marathi" },
	{ language: "MS", name: "Malay" },
	{ language: "MT", name: "Maltese" },
	{ language: "MY", name: "Burmese" },
	{ language: "NB", name: "Norwegian (bokmål)" },
	{ language: "NE", name: "Nepali" },
	{ language: "NL", name: "Dutch" },
	{ language: "OC", name: "Occitan" },
	{ language: "OM", name: "Oromo" },
	{ language: "PA", name: "Punjabi" },
	{ language: "PL", name: "Polish" },
	{ language: "PS", name: "Pashto" },
	{ language: "PT", name: "Portuguese" },
	{ language: "QU", name: "Quechua" },
	{ language: "RO", name: "Romanian" },
	{ language: "RU", name: "Russian" },
	{ language: "SA", name: "Sanskrit" },
	{ language: "SK", name: "Slovak" },
	{ language: "SL", name: "Slovenian" },
	{ language: "SQ", name: "Albanian" },
	{ language: "SR", name: "Serbian" },
	{ language: "ST", name: "Sesotho" },
	{ language: "SU", name: "Sundanese" },
	{ language: "SV", name: "Swedish" },
	{ language: "SW", name: "Swahili" },
	{ language: "TA", name: "Tamil" },
	{ language: "TE", name: "Telugu" },
	{ language: "TG", name: "Tajik" },
	{ language: "TH", name: "Thai" },
	{ language: "TK", name: "Turkmen" },
	{ language: "TL", name: "Tagalog" },
	{ language: "TN", name: "Tswana" },
	{ language: "TR", name: "Turkish" },
	{ language: "TS", name: "Tsonga" },
	{ language: "TT", name: "Tatar" },
	{ language: "UK", name: "Ukrainian" },
	{ language: "UR", name: "Urdu" },
	{ language: "UZ", name: "Uzbek" },
	{ language: "VI", name: "Vietnamese" },
	{ language: "WO", name: "Wolof" },
	{ language: "XH", name: "Xhosa" },
	{ language: "YI", name: "Yiddish" },
	{ language: "ZH", name: "Chinese" },
	{ language: "ZU", name: "Zulu" },
] as const;

const TargetLanguages = [
	{ language: "AF", name: "Afrikaans", supports_formality: false },
	{ language: "AN", name: "Aragonese", supports_formality: false },
	{ language: "AR", name: "Arabic", supports_formality: false },
	{ language: "AS", name: "Assamese", supports_formality: false },
	{ language: "AY", name: "Aymara", supports_formality: false },
	{ language: "AZ", name: "Azerbaijani", supports_formality: false },
	{ language: "BA", name: "Bashkir", supports_formality: false },
	{ language: "BE", name: "Belarusian", supports_formality: false },
	{ language: "BG", name: "Bulgarian", supports_formality: false },
	{ language: "BN", name: "Bengali", supports_formality: false },
	{ language: "BR", name: "Breton", supports_formality: false },
	{ language: "BS", name: "Bosnian", supports_formality: false },
	{ language: "CA", name: "Catalan", supports_formality: false },
	{ language: "CS", name: "Czech", supports_formality: false },
	{ language: "CY", name: "Welsh", supports_formality: false },
	{ language: "DA", name: "Danish", supports_formality: false },
	{ language: "DE", name: "German", supports_formality: true },
	{ language: "EL", name: "Greek", supports_formality: false },
	{ language: "EN-GB", name: "English (British)", supports_formality: false },
	{ language: "EN-US", name: "English (American)", supports_formality: false },
	{ language: "EO", name: "Esperanto", supports_formality: false },
	{ language: "ES", name: "Spanish", supports_formality: true },
	{ language: "ES-419", name: "Spanish (Latin American)", supports_formality: true },
	{ language: "ET", name: "Estonian", supports_formality: false },
	{ language: "EU", name: "Basque", supports_formality: false },
	{ language: "FA", name: "Persian", supports_formality: false },
	{ language: "FI", name: "Finnish", supports_formality: false },
	{ language: "FR", name: "French", supports_formality: true },
	{ language: "GA", name: "Irish", supports_formality: false },
	{ language: "GL", name: "Galician", supports_formality: false },
	{ language: "GN", name: "Guarani", supports_formality: false },
	{ language: "GU", name: "Gujarati", supports_formality: false },
	{ language: "HA", name: "Hausa", supports_formality: false },
	{ language: "HE", name: "Hebrew", supports_formality: false },
	{ language: "HI", name: "Hindi", supports_formality: false },
	{ language: "HR", name: "Croatian", supports_formality: false },
	{ language: "HT", name: "Haitian Creole", supports_formality: false },
	{ language: "HU", name: "Hungarian", supports_formality: false },
	{ language: "HY", name: "Armenian", supports_formality: false },
	{ language: "ID", name: "Indonesian", supports_formality: false },
	{ language: "IG", name: "Igbo", supports_formality: false },
	{ language: "IS", name: "Icelandic", supports_formality: false },
	{ language: "IT", name: "Italian", supports_formality: true },
	{ language: "JA", name: "Japanese", supports_formality: true },
	{ language: "JV", name: "Javanese", supports_formality: false },
	{ language: "KA", name: "Georgian", supports_formality: false },
	{ language: "KK", name: "Kazakh", supports_formality: false },
	{ language: "KO", name: "Korean", supports_formality: false },
	{ language: "KY", name: "Kyrgyz", supports_formality: false },
	{ language: "LA", name: "Latin", supports_formality: false },
	{ language: "LB", name: "Luxembourgish", supports_formality: false },
	{ language: "LN", name: "Lingala", supports_formality: false },
	{ language: "LT", name: "Lithuanian", supports_formality: false },
	{ language: "LV", name: "Latvian", supports_formality: false },
	{ language: "MG", name: "Malagasy", supports_formality: false },
	{ language: "MI", name: "Maori", supports_formality: false },
	{ language: "MK", name: "Macedonian", supports_formality: false },
	{ language: "ML", name: "Malayalam", supports_formality: false },
	{ language: "MN", name: "Mongolian", supports_formality: false },
	{ language: "MR", name: "Marathi", supports_formality: false },
	{ language: "MS", name: "Malay", supports_formality: false },
	{ language: "MT", name: "Maltese", supports_formality: false },
	{ language: "MY", name: "Burmese", supports_formality: false },
	{ language: "NB", name: "Norwegian (bokmål)", supports_formality: false },
	{ language: "NE", name: "Nepali", supports_formality: false },
	{ language: "NL", name: "Dutch", supports_formality: true },
	{ language: "OC", name: "Occitan", supports_formality: false },
	{ language: "OM", name: "Oromo", supports_formality: false },
	{ language: "PA", name: "Punjabi", supports_formality: false },
	{ language: "PL", name: "Polish", supports_formality: true },
	{ language: "PS", name: "Pashto", supports_formality: false },
	{ language: "PT-BR", name: "Portuguese (Brazilian)", supports_formality: true },
	{ language: "PT-PT", name: "Portuguese (European)", supports_formality: true },
	{ language: "QU", name: "Quechua", supports_formality: false },
	{ language: "RO", name: "Romanian", supports_formality: false },
	{ language: "RU", name: "Russian", supports_formality: true },
	{ language: "SA", name: "Sanskrit", supports_formality: false },
	{ language: "SK", name: "Slovak", supports_formality: false },
	{ language: "SL", name: "Slovenian", supports_formality: false },
	{ language: "SQ", name: "Albanian", supports_formality: false },
	{ language: "SR", name: "Serbian", supports_formality: false },
	{ language: "ST", name: "Sesotho", supports_formality: false },
	{ language: "SU", name: "Sundanese", supports_formality: false },
	{ language: "SV", name: "Swedish", supports_formality: false },
	{ language: "SW", name: "Swahili", supports_formality: false },
	{ language: "TA", name: "Tamil", supports_formality: false },
	{ language: "TE", name: "Telugu", supports_formality: false },
	{ language: "TG", name: "Tajik", supports_formality: false },
	{ language: "TH", name: "Thai", supports_formality: false },
	{ language: "TK", name: "Turkmen", supports_formality: false },
	{ language: "TL", name: "Tagalog", supports_formality: false },
	{ language: "TN", name: "Tswana", supports_formality: false },
	{ language: "TR", name: "Turkish", supports_formality: false },
	{ language: "TS", name: "Tsonga", supports_formality: false },
	{ language: "TT", name: "Tatar", supports_formality: false },
	{ language: "UK", name: "Ukrainian", supports_formality: false },
	{ language: "UR", name: "Urdu", supports_formality: false },
	{ language: "UZ", name: "Uzbek", supports_formality: false },
	{ language: "VI", name: "Vietnamese", supports_formality: false },
	{ language: "WO", name: "Wolof", supports_formality: false },
	{ language: "XH", name: "Xhosa", supports_formality: false },
	{ language: "YI", name: "Yiddish", supports_formality: false },
	{ language: "ZH", name: "Chinese (simplified)", supports_formality: false },
	{ language: "ZH-HANS", name: "Chinese (simplified)", supports_formality: false },
	{ language: "ZH-HANT", name: "Chinese (traditional)", supports_formality: false },
	{ language: "ZU", name: "Zulu", supports_formality: false },
] as const;

type SourceLanguageCodes = (typeof SourceLanguages)[number]["language"];
type TargetLanguageCodes = (typeof TargetLanguages)[number]["language"];

interface DeeplResponse {
	translations: {
		detected_source_language: string;
		text: string;
	}[];
}
interface DeeplOptions {
	text: string[];
	source_lang?: SourceLanguageCodes;
	target_lang: TargetLanguageCodes;
	context?: string;
	split_sentences?: "0" | "1" | "nonewlines";
	preserve_formatting?: "0" | "1";
	formality?: "default" | "more" | "less" | "prefer_more" | "prefer_less";
	glossary_id?: string;
	tag_handling?: "xml" | "html";
	outline_detection?: boolean;
	non_splitting_tags?: string[];
	splitting_tags?: string[];
	ignore_tags?: string[];
}

async function translate(options: DeeplOptions): Promise<DeeplResponse> {
	const res = await fetch("https://api-free.deepl.com/v2/translate", {
		method: "POST",
		headers: {
			Authorization: `DeepL-Auth-Key ${config.key}`,
		},
	});
	return res.json() as Promise<DeeplResponse>;
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
				description: "language to translate from",
				type: Discord.ApplicationCommandOptionType.String,
				autocomplete: true,
			},
			{
				name: "formal",
				description:
					"try to get a more formal version if possible for now (DE,ES,FR,IT,JA,NL,PL,PT,RU)",
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
			const to = <TargetLanguageCodes>ctx.options.getString("to") ?? "EN-GB";
			const from = <SourceLanguageCodes>ctx.options.getString("from");
			const formality =
				<DeeplOptions["formality"]>ctx.options.getString("formality") ?? "default";
			const res = await translate({
				text: [text],
				target_lang: to,
				source_lang: from,
				formality: formality,
			});
			if (res) {
				await ctx.reply(
					`**${res.translations[0].detected_source_language} -> ${to}${
						formality
							? ` (${formality === "prefer_more" ? "formal" : "less formal"})`
							: ""
					}**\`\`\`\n${res.translations[0].text}\`\`\``
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
		const focused = ctx.options.getFocused(true);

		const L = focused.name === "to" ? TargetLanguages : SourceLanguages;
		await ctx.respond(
			L.filter(
				function (lang) {
					if (this.limit < 25) {
						this.limit++;
						return lang.name.toLowerCase().includes(focused.value.toLowerCase());
					}
				},
				{ limit: 0 }
			).map(lang => {
				return { name: lang.name, value: lang.language };
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
				text: [text],
				target_lang: "EN-GB",
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
						\`\`\`\n${msg.content}\`\`\`\n**${res.translations[0].detected_source_language} -> EN-GB**\n\`\`\`\n${res.translations[0].text}\`\`\``,
				};
				await ctx.reply({ embeds: [embed], flags: Discord.MessageFlags.Ephemeral });
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
