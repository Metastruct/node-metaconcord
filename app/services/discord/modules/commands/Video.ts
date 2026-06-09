import * as Discord from "discord.js";
import { EphemeralResponse, SlashCommand } from "@/extensions/discord.js";
import { spawn } from "child_process";
import fs from "fs/promises";
import { createWriteStream } from "fs";
import path from "path";
import os from "os";
import axios from "axios";
import { logger } from "@/utils.js";

const log = logger("VideoCommand");

type Method = "repeat" | "reverse" | "ping-pong";

const AllowedVideoTypes = ["video/webm", "video/mp4", "video/quicktime"];
const MAX_FILE_SIZE = 25_000_000;

const GLITCH: { segment: number; count: number }[] = [
	{ segment: 1.0, count: 2 }, // 1  mild
	{ segment: 0.8, count: 3 }, // 2
	{ segment: 0.6, count: 4 }, // 3
	{ segment: 0.4, count: 5 }, // 4
	{ segment: 0.3, count: 6 }, // 5  default
	{ segment: 0.25, count: 8 }, // 6
	{ segment: 0.2, count: 10 }, // 7
	{ segment: 0.15, count: 12 }, // 8
	{ segment: 0.1, count: 16 }, // 9
	{ segment: 0.05, count: 20 }, // 10 insane
];

function runProcess(bin: string, args: string[], timeout = 120_000): Promise<string> {
	return new Promise((resolve, reject) => {
		const proc = spawn(bin, args, {
			stdio: ["ignore", "pipe", "pipe"],
			timeout,
		});
		let stdout = "";
		let stderr = "";
		proc.stdout.on("data", (d: Buffer) => {
			stdout += d.toString();
		});
		proc.stderr.on("data", (d: Buffer) => {
			stderr += d.toString();
		});
		proc.on("close", code => {
			if (code === 0) resolve(stdout);
			else reject(new Error(`${bin} exited ${code}: ${stderr.slice(-1000)}`));
		});
		proc.on("error", err => reject(new Error(`${bin} not found: ${err.message}`)));
	});
}

async function downloadFile(url: string, dest: string): Promise<void> {
	const writer = createWriteStream(dest);
	const response = await axios({ url, method: "GET", responseType: "stream" });
	response.data.pipe(writer);
	return new Promise((resolve, reject) => {
		writer.on("finish", resolve);
		writer.on("error", reject);
	});
}

interface VideoInfo {
	fps: number;
	sampleRate: number;
	channels: number;
	duration: number;
	hasAudio: boolean;
}

async function getVideoInfo(input: string): Promise<VideoInfo> {
	const raw = await runProcess("ffprobe", [
		"-v",
		"error",
		"-show_entries",
		"stream=codec_type,channels,r_frame_rate,sample_rate:format=duration",
		"-of",
		"json",
		input,
	]);
	const data = JSON.parse(raw);
	const vs = data.streams.find((s: any) => s.codec_type === "video");
	const as = data.streams.find((s: any) => s.codec_type === "audio");
	let fps = 30;
	if (vs?.r_frame_rate) {
		const [n, d] = vs.r_frame_rate.split("/").map(Number);
		fps = d ? n / d : n;
	}
	return {
		fps,
		sampleRate: Number(as?.sample_rate) || 48000,
		channels: Number(as?.channels) || 2,
		duration: Number(data.format.duration) || 0,
		hasAudio: !!as,
	};
}

function buildStutterFilter(
	info: VideoInfo,
	at: number,
	segment: number,
	method: Method,
	count: number,
	includeBeginning: boolean,
	includeEnding: boolean
): string {
	const f: string[] = [];
	const concatInputs: string[] = [];
	const loopCount = count > 1 ? count - 1 : -1;
	const frameCount = Math.ceil(segment * info.fps);
	const sampleCount = Math.ceil(segment * info.sampleRate);

	if (includeBeginning && at > 0) {
		f.push(`[0:v]trim=duration=${at},setpts=PTS-STARTPTS[begin_v]`);
		concatInputs.push("begin_v");
		if (info.hasAudio) {
			f.push(`[0:a]atrim=duration=${at},asetpts=PTS-STARTPTS[begin_a]`);
			concatInputs.push("begin_a");
		}
	}

	f.push(`[0:v]trim=start=${at}:duration=${segment},setpts=PTS-STARTPTS[seg_v]`);
	if (info.hasAudio) {
		f.push(`[0:a]atrim=start=${at}:duration=${segment},asetpts=PTS-STARTPTS[seg_a]`);
	}

	let stutterV = "seg_v";
	let stutterA: string | null = info.hasAudio ? "seg_a" : null;

	if (method === "repeat") {
		if (loopCount >= 0) {
			f.push(`[seg_v]loop=${loopCount}:${frameCount}:0[stutter_v]`);
			stutterV = "stutter_v";
			if (info.hasAudio) {
				f.push(`[seg_a]aloop=${loopCount}:${sampleCount}:0[stutter_a]`);
				stutterA = "stutter_a";
			}
		}
	} else if (method === "reverse") {
		f.push(`[seg_v]reverse[rev_v]`);
		stutterV = "rev_v";
		if (info.hasAudio) {
			f.push(`[seg_a]areverse[rev_a]`);
			stutterA = "rev_a";
		}
		if (loopCount >= 0) {
			f.push(`[rev_v]loop=${loopCount}:${frameCount}:0[stutter_v]`);
			stutterV = "stutter_v";
			if (info.hasAudio) {
				f.push(`[rev_a]aloop=${loopCount}:${sampleCount}:0[stutter_a]`);
				stutterA = "stutter_a";
			}
		}
	} else if (method === "ping-pong") {
		f.push(`[seg_v]split[fw_v][bw_v]`);
		if (info.hasAudio) f.push(`[seg_a]asplit[fw_a][bw_a]`);
		f.push(`[bw_v]reverse[rev_v]`);
		if (info.hasAudio) f.push(`[bw_a]areverse[rev_a]`);

		if (info.hasAudio) {
			f.push(`[fw_v][fw_a][rev_v][rev_a]concat=n=2:v=1:a=1[pp_v][pp_a]`);
			stutterV = "pp_v";
			stutterA = "pp_a";
		} else {
			f.push(`[fw_v][rev_v]concat=n=2:v=1:a=0[pp_v]`);
			stutterV = "pp_v";
		}
		const ppFrameCount = 2 * frameCount;
		const ppSampleCount = 2 * sampleCount;
		if (loopCount >= 0) {
			f.push(`[pp_v]loop=${loopCount}:${ppFrameCount}:0[stutter_v]`);
			stutterV = "stutter_v";
			if (info.hasAudio) {
				f.push(`[pp_a]aloop=${loopCount}:${ppSampleCount}:0[stutter_a]`);
				stutterA = "stutter_a";
			}
		}
	}

	if (includeEnding && info.duration > at + segment) {
		f.push(`[0:v]trim=start=${at + segment},setpts=PTS-STARTPTS[end_v]`);
		if (info.hasAudio) {
			f.push(`[0:a]atrim=start=${at + segment},asetpts=PTS-STARTPTS[end_a]`);
		}
	}

	const segLabels: string[] = [];
	if (includeBeginning && at > 0) {
		segLabels.push("begin_v");
		if (info.hasAudio) segLabels.push("begin_a");
	}
	segLabels.push(stutterV);
	if (stutterA) segLabels.push(stutterA);
	if (includeEnding && info.duration > at + segment) {
		segLabels.push("end_v");
		if (info.hasAudio) segLabels.push("end_a");
	}

	const n = segLabels.length / (info.hasAudio ? 2 : 1);
	if (n === 1) {
		f.push(`[${stutterV}]setpts=PTS[outv]`);
		if (stutterA) f.push(`[${stutterA}]asetpts=PTS[outa]`);
	} else {
		f.push(
			`${segLabels.map(l => `[${l}]`).join("")}concat=n=${n}:v=1:a=${info.hasAudio ? 1 : 0}[outv]${
				info.hasAudio ? "[outa]" : ""
			}`
		);
	}

	return f.join(";");
}

function buildFreezeFilter(
	info: VideoInfo,
	at: number,
	freezeDuration: number,
	includeBeginning: boolean,
	includeEnding: boolean,
	silence: boolean
): string {
	const f: string[] = [];
	const freezeFrames = Math.max(1, Math.round(freezeDuration * info.fps));

	if (includeBeginning && at > 0) {
		f.push(`[0:v]trim=duration=${at},setpts=PTS-STARTPTS[begin_v]`);
		if (info.hasAudio) {
			f.push(`[0:a]atrim=duration=${at},asetpts=PTS-STARTPTS[begin_a]`);
		}
	}

	const frameDuration = 1 / info.fps;
	f.push(`[0:v]trim=start=${at}:duration=${frameDuration},setpts=PTS-STARTPTS[freeze_raw]`);
	f.push(`[freeze_raw]loop=${freezeFrames - 1}:1:0[freeze_v]`);

	if (info.hasAudio) {
		if (silence) {
			f.push(`aevalsrc=0:s=${info.sampleRate}:c=${info.channels}:d=${freezeDuration}[freeze_a]`);
		} else {
			const sampleDuration = Math.min(0.05, info.duration * 0.5);
			const audioAt = Math.min(at, Math.max(0, info.duration - sampleDuration));
			const freezeAudioLoops = Math.max(0, Math.ceil(freezeDuration / sampleDuration) - 1);
			const freezeAudioSamples = Math.ceil(sampleDuration * info.sampleRate);
			f.push(`[0:a]atrim=start=${audioAt}:duration=${sampleDuration}[freeze_audio_raw]`);
			if (freezeAudioLoops > 0) {
				f.push(`[freeze_audio_raw]aloop=${freezeAudioLoops}:${freezeAudioSamples}:0[freeze_a]`);
			} else {
				f.push(`[freeze_audio_raw]asetpts=PTS[freeze_a]`);
			}
		}
	}

	if (includeEnding) {
		f.push(`[0:v]trim=start=${at},setpts=PTS-STARTPTS[end_v]`);
		if (info.hasAudio) {
			f.push(`[0:a]atrim=start=${at},asetpts=PTS-STARTPTS[end_a]`);
		}
	}

	const segLabels: string[] = [];
	if (includeBeginning && at > 0) {
		segLabels.push("begin_v");
		if (info.hasAudio) segLabels.push("begin_a");
	}
	segLabels.push("freeze_v");
	if (info.hasAudio) segLabels.push("freeze_a");
	if (includeEnding) {
		segLabels.push("end_v");
		if (info.hasAudio) segLabels.push("end_a");
	}

	const n = segLabels.length / (info.hasAudio ? 2 : 1);
	if (n === 1) {
		f.push(`[freeze_v]setpts=PTS[outv]`);
		if (info.hasAudio) f.push(`[freeze_a]asetpts=PTS[outa]`);
	} else {
		f.push(
			`${segLabels.map(l => `[${l}]`).join("")}concat=n=${n}:v=1:a=${info.hasAudio ? 1 : 0}[outv]${
				info.hasAudio ? "[outa]" : ""
			}`
		);
	}

	return f.join(";");
}

function buildCrushFilter(
	info: VideoInfo,
	at: number,
	duration: number,
	intensity: number,
	includeBeginning: boolean,
	includeEnding: boolean
): string {
	const f: string[] = [];
	const concatInputs: string[] = [];
	const div = Math.max(1, Math.round(intensity / 2));
	const bits = Math.max(1, Math.round(11 - intensity));
	const samples = Math.min(10, Math.max(1, Math.round(intensity / 2)));
	const aa = intensity >= 6 ? 0 : 1;

	if (includeBeginning && at > 0) {
		f.push(`[0:v]trim=duration=${at},setpts=PTS-STARTPTS[begin_v]`);
		concatInputs.push("begin_v");
		if (info.hasAudio) {
			f.push(`[0:a]atrim=duration=${at},asetpts=PTS-STARTPTS[begin_a]`);
			concatInputs.push("begin_a");
		}
	}

	f.push(
		`[0:v]trim=start=${at}:duration=${duration},setpts=PTS-STARTPTS,` +
			`scale=iw/${div}:ih/${div}:flags=neighbor,scale=iw*${div}:ih*${div}:flags=neighbor[crush_v]`
	);
	if (info.hasAudio) {
		f.push(
			`[0:a]atrim=start=${at}:duration=${duration},asetpts=PTS-STARTPTS,` +
				`acrusher=bits=${bits}:mode=log:aa=${aa}:samples=${samples}[crush_a]`
		);
	}

	concatInputs.push("crush_v");
	if (info.hasAudio) concatInputs.push("crush_a");

	if (includeEnding && info.duration > at + duration) {
		f.push(`[0:v]trim=start=${at + duration},setpts=PTS-STARTPTS[end_v]`);
		concatInputs.push("end_v");
		if (info.hasAudio) {
			f.push(`[0:a]atrim=start=${at + duration},asetpts=PTS-STARTPTS[end_a]`);
			concatInputs.push("end_a");
		}
	}

	const n = concatInputs.length / (info.hasAudio ? 2 : 1);
	f.push(
		`${concatInputs.map(l => `[${l}]`).join("")}concat=n=${n}:v=1:a=${info.hasAudio ? 1 : 0}[outv]${
			info.hasAudio ? "[outa]" : ""
		}`
	);

	return f.join(";");
}

async function processVideo(
	ctx: Discord.ChatInputCommandInteraction,
	url: string | null,
	file: Discord.Attachment | null,
	effectName: string,
	buildFilter: (info: VideoInfo) => string
): Promise<void> {
	await ctx.deferReply();

	if (!url && !file) {
		await ctx.editReply("I need either a URL or a file for this.");
		return;
	}

	if (url && !url.match(/^https?:\/\/.+\..+$/g)) {
		await ctx.editReply("That doesn't look like a valid URL.");
		return;
	}

	if (file && file.contentType && !AllowedVideoTypes.includes(file.contentType)) {
		await ctx.editReply(
			`${file.contentType} is not a supported video type. Supported: MP4, WebM, QuickTime`
		);
		return;
	}

	const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "metaconcord-video-"));
	const inputPath = path.join(tmpDir, "input.mp4");
	const outputPath = path.join(tmpDir, "output.mp4");

	try {
		const sourceUrl = file ? file.url : url!;
		log.debug({ sourceUrl }, "downloading video");
		await downloadFile(sourceUrl, inputPath);

		log.debug("probing video");
		const info = await getVideoInfo(inputPath);
		if (info.duration === 0) {
			await ctx.followUp(
				EphemeralResponse("Couldn't determine video duration. Is this actually a video?")
			);
			return;
		}

		log.debug({ effectName }, "building filter graph");
		const filterGraph = buildFilter(info);

		const ffArgs: string[] = [
			"-i",
			inputPath,
			"-filter_complex",
			filterGraph,
			"-map",
			"[outv]",
			...(info.hasAudio ? ["-map", "[outa]"] : []),
			"-c:v",
			"libx264",
			"-preset",
			"ultrafast",
			"-crf",
			"28",
			...(info.hasAudio ? ["-c:a", "aac"] : []),
			"-movflags",
			"+faststart",
			"-y",
			outputPath,
		];

		log.debug("running ffmpeg");
		await runProcess("ffmpeg", ffArgs);

		const stat = await fs.stat(outputPath);
		if (stat.size > MAX_FILE_SIZE) {
			await ctx.followUp(
				EphemeralResponse(
					"Output is too large — Discord won't accept it. Try a shorter duration or fewer repeats."
				)
			);
			return;
		}

		const buf = await fs.readFile(outputPath);
		await ctx.followUp({
			files: [{ attachment: buf, name: `${effectName}.mp4` }],
		});
	} catch (err) {
		log.error({ err, effectName }, "video command failed");
		await ctx.followUp(EphemeralResponse("Something went wrong processing the video."));
	} finally {
		await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
	}
}

async function handleStutter(ctx: Discord.ChatInputCommandInteraction) {
	const url = ctx.options.getString("url");
	const file = ctx.options.getAttachment("file");
	const at = ctx.options.getNumber("at") ?? 0;
	const method = (ctx.options.getString("method") ?? "ping-pong") as Method;
	const glitch = ctx.options.getInteger("glitch") ?? 5;
	const explicitSegment = ctx.options.getNumber("segment");
	const explicitCount = ctx.options.getInteger("count");
	const includeBeginning = ctx.options.getBoolean("include_beginning") ?? false;
	const includeEnding = ctx.options.getBoolean("include_ending") ?? false;

	const g = GLITCH[Math.max(0, Math.min(9, glitch - 1))];
	const segment = explicitSegment ?? g.segment;
	const count = explicitCount ?? g.count;

	await processVideo(ctx, url, file, "stutter", info => {
		const effectiveAt = Math.min(at, info.duration);
		const effectiveSegment = Math.min(segment, Math.max(0, info.duration - effectiveAt));
		if (effectiveSegment <= 0) throw new Error("Start time beyond video duration");
		return buildStutterFilter(
			info,
			effectiveAt,
			effectiveSegment,
			method,
			count,
			includeBeginning,
			includeEnding
		);
	});
}

async function handleFreeze(ctx: Discord.ChatInputCommandInteraction) {
	const url = ctx.options.getString("url");
	const file = ctx.options.getAttachment("file");
	const at = ctx.options.getNumber("at") ?? 0;
	const freezeDuration = ctx.options.getNumber("duration") ?? 2;
	const includeBeginning = ctx.options.getBoolean("include_beginning") ?? false;
	const includeEnding = ctx.options.getBoolean("include_ending") ?? false;
	const silence = ctx.options.getBoolean("silence") ?? false;

	await processVideo(ctx, url, file, "freeze", info => {
		const effectiveAt = Math.min(at, info.duration);
		return buildFreezeFilter(
			info,
			effectiveAt,
			freezeDuration,
			includeBeginning,
			includeEnding,
			silence
		);
	});
}

async function handleCrush(ctx: Discord.ChatInputCommandInteraction) {
	const url = ctx.options.getString("url");
	const file = ctx.options.getAttachment("file");
	const at = ctx.options.getNumber("at") ?? 0;
	const duration = ctx.options.getNumber("duration") ?? 3;
	const intensity = ctx.options.getInteger("intensity") ?? 5;
	const includeBeginning = ctx.options.getBoolean("include_beginning") ?? false;
	const includeEnding = ctx.options.getBoolean("include_ending") ?? false;

	await processVideo(ctx, url, file, "crush", info => {
		const effectiveAt = Math.min(at, info.duration);
		const effectiveDuration = Math.min(duration, Math.max(0, info.duration - effectiveAt));
		if (effectiveDuration <= 0) throw new Error("Start time beyond video duration");
		return buildCrushFilter(
			info,
			effectiveAt,
			effectiveDuration,
			intensity,
			includeBeginning,
			includeEnding
		);
	});
}

export const SlashVideoCommand: SlashCommand = {
	options: {
		name: "video",
		description: "Funny video effects",
		options: [
			{
				type: Discord.ApplicationCommandOptionType.Subcommand,
				name: "stutter",
				description: "Repeat/reverse/ping-pong a segment in quick succession",
				options: [
					{
						type: Discord.ApplicationCommandOptionType.String,
						name: "url",
						description: "Video URL",
					},
					{
						type: Discord.ApplicationCommandOptionType.Attachment,
						name: "file",
						description: "Video file",
					},
					{
						type: Discord.ApplicationCommandOptionType.Number,
						name: "at",
						description: "Time in seconds where the stutter starts",
					},
					{
						type: Discord.ApplicationCommandOptionType.Integer,
						name: "glitch",
						description: "How aggressive (1=mild, 5=classic, 10=insane)",
						min_value: 1,
						max_value: 10,
					},
					{
						type: Discord.ApplicationCommandOptionType.String,
						name: "method",
						description: "Stutter pattern",
						choices: [
							{ name: "repeat", value: "repeat" },
							{ name: "reverse", value: "reverse" },
							{ name: "ping-pong", value: "ping-pong" },
						],
					},
					{
						type: Discord.ApplicationCommandOptionType.Number,
						name: "segment",
						description: "Override: length of video snippet to grab (seconds)",
						min_value: 0.05,
						max_value: 5,
					},
					{
						type: Discord.ApplicationCommandOptionType.Integer,
						name: "count",
						description: "Override: exact number of repetitions",
						min_value: 1,
						max_value: 30,
					},
					{
						type: Discord.ApplicationCommandOptionType.Boolean,
						name: "include_beginning",
						description: "Include the part before the stutter",
					},
					{
						type: Discord.ApplicationCommandOptionType.Boolean,
						name: "include_ending",
						description: "Include the part after the stutter",
					},
				],
			},
			{
				type: Discord.ApplicationCommandOptionType.Subcommand,
				name: "freeze",
				description: "Freeze on a single frame",
				options: [
					{
						type: Discord.ApplicationCommandOptionType.String,
						name: "url",
						description: "Video URL",
					},
					{
						type: Discord.ApplicationCommandOptionType.Attachment,
						name: "file",
						description: "Video file",
					},
					{
						type: Discord.ApplicationCommandOptionType.Number,
						name: "at",
						description: "Time in seconds where the freeze happens",
					},
					{
						type: Discord.ApplicationCommandOptionType.Number,
						name: "duration",
						description: "How long to freeze (seconds)",
						min_value: 0.5,
						max_value: 10,
					},
					{
						type: Discord.ApplicationCommandOptionType.Boolean,
						name: "include_beginning",
						description: "Include the part before the freeze",
					},
					{
						type: Discord.ApplicationCommandOptionType.Boolean,
						name: "include_ending",
						description: "Include the part after the freeze",
					},
					{
						type: Discord.ApplicationCommandOptionType.Boolean,
						name: "silence",
						description: "Use silence instead of audio looping",
					},
				],
			},
			{
				type: Discord.ApplicationCommandOptionType.Subcommand,
				name: "bitcrush",
				description: "Destroy video quality and bitcrush the audio",
				options: [
					{
						type: Discord.ApplicationCommandOptionType.String,
						name: "url",
						description: "Video URL",
					},
					{
						type: Discord.ApplicationCommandOptionType.Attachment,
						name: "file",
						description: "Video file",
					},
					{
						type: Discord.ApplicationCommandOptionType.Number,
						name: "at",
						description: "Time in seconds where the crush starts",
					},
					{
						type: Discord.ApplicationCommandOptionType.Number,
						name: "duration",
						description: "How long the crush lasts (seconds)",
						min_value: 0.5,
						max_value: 10,
					},
					{
						type: Discord.ApplicationCommandOptionType.Integer,
						name: "intensity",
						description:
							"How destroyed it gets (1 = mild, 10 = completely obliterated)",
						min_value: 1,
						max_value: 10,
					},
					{
						type: Discord.ApplicationCommandOptionType.Boolean,
						name: "include_beginning",
						description: "Include the part before the crush",
					},
					{
						type: Discord.ApplicationCommandOptionType.Boolean,
						name: "include_ending",
						description: "Include the part after the crush",
					},
				],
			},
		],
	},

	async execute(ctx) {
		const subcommand = ctx.options.getSubcommand();
		switch (subcommand) {
			case "stutter":
				return handleStutter(ctx);
			case "freeze":
				return handleFreeze(ctx);
			case "crush":
				return handleCrush(ctx);
		}
	},
};
