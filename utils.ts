export const sleep = (ms: number): Promise<any> => new Promise(resolve => setTimeout(resolve, ms));
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
