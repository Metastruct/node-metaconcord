import { Container } from "../Container";
import { Service } from ".";
import axios from "axios";
import config from "@/config/tenor.json";

const ENDPOINT = "https://tenor.googleapis.com/v2/search";

const FORMATS = [
	"preview",
	"gif",
	"mediumgif",
	"tinygif",
	"nanogif",
	"mp4",
	"loopedmp4",
	"tinymp4",
	"nanomp4",
	"webm",
	"tinywebm",
	"nanowebm",
	"webp_transparent",
	"tinywebp_transparent",
	"nanowebp_transparent",
	"gif_transparent",
	"tinygif_transparent",
	"nanogif_transparent",
] as const;

type ContentFormat = typeof FORMATS[number];

type MediaObject = {
	url: string;
	dims: number[];
	duration: number;
	size: number;
};

type ResponseObject = {
	created: number;
	hasaudio: boolean;
	id: string;
	media_formats: Record<ContentFormat, MediaObject>;
	tags: string[];
	title: string;
	content_description: string;
	itemurl: string;
	hascaption: boolean;
	flags: string;
	bg_color: string;
	url: string;
};

export type TenorResponse = {
	next: string;
	results: ResponseObject[];
};

export class Tenor extends Service {
	name = "Tenor";

	async search(query: string, limit?: number, random?: boolean) {
		return await axios.get<TenorResponse>(ENDPOINT, {
			params: {
				q: query,
				key: config.apiKey,
				client_key: "metaconcord",
				limit: limit,
				random: random,
			},
		});
	}
}
export default (container: Container): Service => {
	return new Tenor(container);
};
