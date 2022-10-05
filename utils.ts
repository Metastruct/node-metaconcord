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
