import { CommandContext, CommandOptionType, SlashCommand, SlashCreator } from "slash-create";
import { DiscordBot } from "../..";
import { EphemeralResponse } from ".";
import { FFmpeg, createFFmpeg, fetchFile } from "@ffmpeg.wasm/main";
import { decode, encode } from "node-wav";
import { randomUUID } from "crypto";

type DecodedWAV = {
	channelData: Float32Array[];
	sampleRate: number;
};

type Method = "repeat" | "reverse" | "ping-pong";

const AllowedVideoTypes = ["video/webm", "video/mp4", "video/quicktime"];

export class SlashVideoCommand extends SlashCommand {
	bot: DiscordBot;
	ffmpeg: FFmpeg;
	constructor(bot: DiscordBot, creator: SlashCreator) {
		super(creator, {
			name: "video",
			description: "Video related commands",
			deferEphemeral: true,
			guildIDs: [bot.config.bot.primaryGuildId],
			options: [
				{
					type: CommandOptionType.SUB_COMMAND,
					name: "stutter",
					description: "funny video shuffling",
					options: [
						{ name: "url", type: CommandOptionType.STRING, description: "video url" },
						{
							name: "file",
							type: CommandOptionType.ATTACHMENT,
							description: "video file",
						},
						{
							name: "at",
							type: CommandOptionType.NUMBER,
							description: "seconds when to do something",
						},
						{
							name: "method",
							type: CommandOptionType.STRING,
							description: "what to do",
							choices: [
								{ name: "repeat", value: "repeat" },
								{ name: "reverse", value: "reverse" },
								{ name: "ping-pong", value: "ping-pong" },
							],
						},
						{
							name: "for",
							type: CommandOptionType.NUMBER,
							max_value: 10,
							description: "how many times to do something",
						},
						{
							name: "repeat",
							type: CommandOptionType.INTEGER,
							max_value: 5,
							description: "repeat that x times",
						},
						{
							name: "include_beginning",
							type: CommandOptionType.BOOLEAN,
							description: "whether to include the beginning or not",
						},
					],
				},
			],
		});
		this.filePath = __filename;
		this.bot = bot;
	}

	async doStutter(
		filename: string,
		at: number,
		method: Method,
		doFor: number,
		repeat: number,
		include_beginning: boolean
	) {
		await this.ffmpeg.run(
			"-i",
			`${filename}`,
			"-qscale:v",
			"4",
			"-vf",
			"fps=30",
			"frame%06d.png"
		);
		await this.ffmpeg.run(`-i`, `${filename}`, `${filename}.wav`);
		this.ffmpeg.FS("unlink", filename); // remove original file as we have it split up

		const fps = 30;

		// frames
		const frames = this.ffmpeg.FS("readdir", `/`).filter(f => f.endsWith(".png"));
		const frameLen = frames.length;
		const start = fps * at;
		const end = start + fps * doFor;
		const selectedFrames = frames.slice(start, end);
		let videoOutput: string[] = [];

		// audio
		const af = this.ffmpeg.FS("readFile", `${filename}.wav`);
		const audio: DecodedWAV = await decode(af);
		const audioLength = audio.channelData[0].length / audio.sampleRate;
		const audioStart = audio.sampleRate * at;
		const audioEnd = audioStart + audio.sampleRate * doFor;
		const selectedAudio = audio.channelData.map(t => t.slice(audioStart, audioEnd));
		let audioOutput: Float32Array[];

		switch (method) {
			case "repeat":
				videoOutput = selectedFrames;
				audioOutput = selectedAudio;
				break;
			case "reverse":
				videoOutput = selectedFrames.reverse();
				audioOutput = selectedAudio.map(t => t.reverse());
				break;
			case "ping-pong":
				videoOutput.push(...selectedFrames, ...selectedFrames.reverse());
				audioOutput = selectedAudio.map(t => new Float32Array([...t, ...t.reverse()]));
				break;
		}
		if (repeat !== 0) {
			for (let i = 0; i < repeat; i++) {
				videoOutput = videoOutput.concat(videoOutput);
				const tr1 = audioOutput[0];
				const tr2 = audioOutput[1];
				audioOutput = [
					new Float32Array([...tr1, ...tr1]),
					new Float32Array([...tr2, ...tr2]),
				];
			}
		}

		if (include_beginning) {
			if (start !== 0) videoOutput = frames.slice(0, start).concat(videoOutput);
			if (audioStart !== 0)
				audioOutput = [
					new Float32Array([
						...audio.channelData[0].slice(0, audioStart),
						...audioOutput[0],
					]),
					new Float32Array([
						...audio.channelData[1].slice(0, audioStart),
						...audioOutput[1],
					]),
				];
		}

		this.ffmpeg.FS("writeFile", "concat.txt", videoOutput.map(f => `file ${f}`).join("\n"));

		this.ffmpeg.FS(
			"writeFile",
			`${filename}.wav`,
			encode(audioOutput, { sampleRate: audio.sampleRate })
		);

		return [
			"-safe",
			"0",
			"-r",
			"30",
			"-f",
			"concat",
			"-i",
			"concat.txt",
			"-i",
			`${filename}.wav`,
			"-vf",
			"fps=30",
			"-shortest",
			"-map",
			"0:v",
			"-map",
			"1:a",
			filename,
		];
	}

	async run(ctx: CommandContext): Promise<any> {
		await ctx.defer();
		this.ffmpeg = createFFmpeg();
		const url: string | undefined = ctx.options.stutter.url;
		const file: string | undefined = ctx.options.stutter.file;
		const attachment = ctx.attachments.first();
		const at: number = ctx.options.stutter.at ?? 0;
		const method: Method = ctx.options.stutter.method ?? "ping-pong";
		const doFor: number = ctx.options.stutter.for ?? 1;
		const repeat: number = ctx.options.stutter.repeat ?? 0;
		const include_beginning: boolean = ctx.options.stutter.include_beginning ?? false;

		if (!url && !file) return EphemeralResponse("I need either an url or file for this...");
		if (ctx.attachments.size > 1)
			EphemeralResponse("I can't do multiple files yet so I'll just do the first");
		if (attachment?.content_type && !AllowedVideoTypes.includes(attachment.content_type))
			return EphemeralResponse(
				`${attachment?.content_type} is not a video file. If you think that's wrong ping <@94829082360942592>`
			);

		try {
			const fn = `tmp-${randomUUID()}.mp4`;
			await this.ffmpeg.load();
			this.ffmpeg.FS(
				"writeFile",
				`${fn}`,
				await fetchFile(attachment ? attachment.url : url ?? "wtf")
			);
			await this.ffmpeg.run(
				...(await this.doStutter(fn, at, method, doFor, repeat, include_beginning))
			);
			await ctx.send(
				{
					file: {
						file: Buffer.from(this.ffmpeg.FS("readFile", fn)),
						name: "stutter.mp4",
					},
				},
				{ ephemeral: false }
			);
		} catch (err) {
			console.log(err);
			return EphemeralResponse("Something went wrong transcoding the video :(");
		}
	}
}
