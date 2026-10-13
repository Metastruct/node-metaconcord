import { regex as tsRegex } from "ts-regexp";

type RegexFlag = "d" | "g" | "i" | "m" | "s" | "u" | "v" | "y";
type HasGlobalFlag<TFlags extends string> = TFlags extends `${string}g${string}` ? true : false;
type UniqueRegexFlags<TFlags extends string, TSeen extends string = never> =
	TFlags extends `${infer TFlag}${infer TRest}`
		? TFlag extends RegexFlag
			? TFlag extends TSeen
				? never
				: `${TFlag}${UniqueRegexFlags<TRest, TSeen | TFlag>}`
			: never
		: "";
type ConcordFlags<TFlags extends string> = string extends TFlags
	? TFlags
	: UniqueRegexFlags<TFlags> extends never
		? never
		: HasGlobalFlag<TFlags> extends true
			? TFlags
			: never;

type TsRegexMatchAllIn<TRegex extends string, TFlags extends string> =
	typeof tsRegex<TRegex, TFlags> extends (...args: any[]) => infer TResult
		? TResult extends { global: true; matchAllIn: infer TMatchAllIn }
			? TMatchAllIn
			: never
		: never;

type ConcordMatchAllResult<TRegex extends string, TFlags extends string> = TsRegexMatchAllIn<
	TRegex,
	TFlags
> extends (input: string) => infer TResult
	? TResult
	: never;

type ConcordMatchAll = <TRegex extends string, TFlags extends string>(
	regex: TRegex,
	flags: ConcordFlags<TFlags>,
) => ConcordMatchAllResult<TRegex, TFlags>;

type ConcordStringExtension = {
	matchAll: ConcordMatchAll;
};

declare global {
	interface String {
		readonly concord: ConcordStringExtension;
	}
}

Object.defineProperty(String.prototype, "concord", {
	configurable: true,
	get(this: string) {
		const input = String(this);
		const matchAll: ConcordMatchAll = <TRegex extends string, TFlags extends string>(
			regex: TRegex,
			flags: ConcordFlags<TFlags>,
		) =>
			(
				tsRegex(regex, flags as Parameters<typeof tsRegex<TRegex, TFlags>>[1]) as unknown as {
					matchAllIn(source: string): ConcordMatchAllResult<TRegex, TFlags>;
				}
			).matchAllIn(input);
		return { matchAll };
	},
});

export {};
