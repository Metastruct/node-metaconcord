import { PathLike, promises as fs } from "fs";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import apikeys from "@/config/apikeys.json" with { type: "json" };
import axios from "axios";
import request, { gql } from "graphql-request";
import webappconfig from "@/config/webapp.json" with { type: "json" };

export const sleep = (ms: number): Promise<any> => new Promise(resolve => setTimeout(resolve, ms));

export const clamp = (input: number, min: number, max: number): number =>
	input <= min ? min : input >= max ? max : input;

export const f = (
	name: string,
	value: string,
	inline?: boolean
): { name: string; value: string; inline: boolean }[] => [
	{
		name,
		value,
		inline: !!inline,
	},
];

export const exists = async (path: PathLike): Promise<boolean> =>
	fs
		.access(path)
		.then(() => true)
		.catch(() => false);

export const getStackLines = (input: string, linestart: number, lineend?: number): string => {
	const lines = input.split(/\r?\n/).map(str => "  " + str);
	const line = clamp(linestart, 0, lines.length) - 1;
	const replace = lines.slice(line, lineend ?? line + 1).map(line => ">>" + line.substring(2));
	lines.splice(line, lineend ? lineend - linestart : 1, ...replace);
	return lines
		.slice(clamp(line - 10 / 2, 0, lines.length), clamp(line + 10 / 2, 0, lines.length))
		.join("\n");
};

export const AddonURIS = {
	acf: "https://github.com/metastruct/ACF/blob/master/",
	advdupe2: "https://github.com/wiremod/advdupe2/blob/master/",
	aowl: "https://gitlab.com/metastruct/internal/aowl/-/blob/master/",
	easychat: "https://github.com/Earu/EasyChat/blob/master/",
	epoe: "https://github.com/Metastruct/EPOE/blob/master/",
	fast_addons: "https://gitlab.com/metastruct/internal/fast_addons/-/blob/master/",
	gcompute: "https://github.com/Metastruct/gcompute/blob/master/",
	luadev: "https://github.com/Metastruct/luadev/blob/master/",
	metaconcord: "https://github.com/metastruct/gmod-metaconcord/blob/master/",
	metastruct: "https://gitlab.com/metastruct/internal/metastruct/-/blob/master/",
	metaworks: "https://gitlab.com/metastruct/metaworks/MetaWorks/-/blob/master/",
	"neo-chatsounds": "https://github.com/Earu/neo-chatsounds/blob/main/",
	mta: "https://gitlab.com/metastruct/mta_projects/mta/-/blob/master/",
	mta_gamemode: "https://gitlab.com/metastruct/mta_projects/mta_gm/-/blob/master/",
	pac3: "https://github.com/CapsAdmin/pac3/blob/develop/",
	sandbox_modded: "https://gitlab.com/metastruct/internal/qbox/-/blob/master/",
	swcs: "https://gitlab.com/cynhole/swcs/-/blob/master/",
	vrmod: "https://github.com/Metastruct/vrmod-addon/blob/master/",
	wire: "https://github.com/Metastruct/wire/blob/master/",
};

const LOOKUP_PATH = webappconfig.lookupPath;
export const GMOD_PATH_MATCH =
	/^(?<path>(?:lua|gamemodes)\/(?<addon>[-_.A-Za-z0-9]+?|)?(?:\/.*)?\/(?<filename>[-_.A-Za-z0-9]+)\.(?<ext>[a-z]*))?(?::-?(?<linenos>\d+)-?(?<linenoe>\d+)?)?$/g;

export const getAsBase64 = async (url: string): Promise<string | null> => {
	if (!url.match(/^https?:\/\/.+/)) return null;
	try {
		const res = await axios.get(url, { responseType: "arraybuffer" });

		const contentType = res.headers["content-type"] || "image/png";
		const base64 = Buffer.from(res.data, "binary").toString("base64");

		return `data:${contentType};base64,${base64}`;
	} catch (error) {
		return null;
	}
};

interface GithubResponse {
	repository: {
		content: {
			text: string;
		};
	};
}
interface GitlabResponse {
	project: {
		repository: {
			blobs: {
				nodes: { rawTextBlob: string }[];
			};
		};
	};
}

export const getOrFetchGmodFile = async (path: PathLike) => {
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	const [, fpath, addon, filename, ext, linenos, linenoe] =
		new RegExp(GMOD_PATH_MATCH).exec(<string>path) || [];
	const fullpath = LOOKUP_PATH + fpath;

	if (await exists(fullpath)) {
		const path = await fs.realpath(fullpath);
		if (!path.startsWith(LOOKUP_PATH)) return undefined;
		const file = await fs.readFile(fullpath, "utf8");
		return linenos
			? getStackLines(file, Number(linenos), linenoe ? Number(linenoe) : undefined)
			: file;
	} else {
		const url: string | undefined = addon ? AddonURIS[addon] : undefined;

		if (url) {
			const provider = url.match(/([^\.\/]+)\.com/);
			if (!provider) return;
			const isGithub = provider[1] === "github";
			const endpoint = isGithub
				? "https://api.github.com/graphql"
				: "https://gitlab.com/api/graphql";
			const repo = addon;
			const owner = url.match(/\.com\/(.+?)\//);
			const branch = url.split("/").at(-2);

			if (!owner) return;
			const query = isGithub
				? gql`{
			repository(owner:"${owner[1]}", name:"${repo}") {
				content: object(expression:"${branch}:${path}") {
					... on Blob {
						text
					}
				}
			}
	}
	`
				: gql`{
		project(fullPath:"${url.match(/\.com\/(.+?)\/\-/)?.[1]}") {
			repository {
				blobs(paths:"${path}"){
					nodes{rawTextBlob}
				}
			}
		}
	}
	`;
			try {
				const data = await request<GithubResponse | GitlabResponse>(
					endpoint,
					query,
					{},
					{
						authorization: `Bearer ${isGithub ? apikeys.github : apikeys.gitlab}`,
					}
				);
				if (data) {
					const filecontent = isGithub
						? (data as GithubResponse).repository.content.text
						: (data as GitlabResponse).project.repository.blobs.nodes[0].rawTextBlob;
					return linenos
						? getStackLines(filecontent, Number(linenos), Number(linenoe))
						: filecontent;
				}
				return;
			} catch (err) {
				console.error(JSON.stringify(err, undefined, 2));
				return;
			}
		}
	}
};

export const makeSpeechBubble = async (
	link: string,
	flip?: boolean,
	fillcolor?: string,
	strokecolor?: string,
	linewidth?: number
): Promise<Buffer> => {
	const image = await loadImage(link);
	const canvas = createCanvas(image.width, image.height);
	const ctx = canvas.getContext("2d");
	const w = canvas.width;
	const h = canvas.height;

	ctx.globalCompositeOperation = "source-over";
	ctx.drawImage(image, 0, 0);

	if (flip) {
		ctx.translate(w, 0);
		ctx.scale(-1, 1);
	}
	ctx.globalCompositeOperation = fillcolor ? "source-over" : "destination-out";
	ctx.beginPath();
	ctx.moveTo(0, 0);
	ctx.quadraticCurveTo(0, 0.1 * h, 0.6 * w, 0.1 * h);
	ctx.quadraticCurveTo(0.6 * w, 0.15 * h, 0.5 * w, 0.2 * h);
	ctx.quadraticCurveTo(0.75 * w, 0.2 * h, 0.75 * w, 0.1 * h);
	ctx.quadraticCurveTo(w, 0.1 * h, w, 0);
	if (fillcolor) ctx.fillStyle = fillcolor;
	ctx.fill();

	ctx.globalCompositeOperation = "source-over";
	ctx.beginPath();
	ctx.moveTo(0, 0);
	ctx.quadraticCurveTo(0, 0.1 * h, 0.6 * w, 0.1 * h);
	ctx.quadraticCurveTo(0.6 * w, 0.15 * h, 0.5 * w, 0.2 * h);
	ctx.quadraticCurveTo(0.75 * w, 0.2 * h, 0.75 * w, 0.1 * h);
	ctx.quadraticCurveTo(w, 0.1 * h, w, 0);
	ctx.strokeStyle = strokecolor ?? "rgba(0, 0, 0, 0)";
	ctx.lineWidth = linewidth ?? 4;
	ctx.stroke();

	return canvas.encode("png");
};

export const isAdmin = async (steamid: string) => {
	const res = await axios.get(
		"https://steamcommunity.com/gid/103582791433481287/memberslistxml?xml=1"
	);
	return !!res.data.match(steamid);
};
