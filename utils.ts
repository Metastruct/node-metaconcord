import { createCanvas, loadImage } from "canvas";

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
export const makeSpeechBubble = async (
	link: string,
	strokecolor = "rgba(0, 0, 0, 0)",
	linewidth = 1
): Promise<Buffer> => {
	const image = await loadImage(link);
	const canvas = createCanvas(image.width, image.height);
	const ctx = canvas.getContext("2d");
	const w = canvas.width;
	const h = canvas.height;

	ctx.globalCompositeOperation = "source-over";
	ctx.drawImage(image, 0, 0);

	ctx.globalCompositeOperation = "destination-out";
	ctx.moveTo(0, 0);
	ctx.quadraticCurveTo(0, 0.1 * h, 0.6 * w, 0.1 * h);
	ctx.quadraticCurveTo(0.6 * w, 0.15 * h, 0.5 * w, 0.2 * h);
	ctx.quadraticCurveTo(0.75 * w, 0.2 * h, 0.75 * w, 0.1 * h);
	ctx.quadraticCurveTo(w, 0.1 * h, w, 0);
	ctx.fill();

	ctx.globalCompositeOperation = "source-over";
	ctx.moveTo(0, 0);
	ctx.quadraticCurveTo(0, 0.1 * h, 0.6 * w, 0.1 * h);
	ctx.quadraticCurveTo(0.6 * w, 0.15 * h, 0.5 * w, 0.2 * h);
	ctx.quadraticCurveTo(0.75 * w, 0.2 * h, 0.75 * w, 0.1 * h);
	ctx.quadraticCurveTo(w, 0.1 * h, w, 0);
	ctx.strokeStyle = strokecolor;
	ctx.lineWidth = linewidth;
	ctx.stroke();

	return canvas.toBuffer();
};
