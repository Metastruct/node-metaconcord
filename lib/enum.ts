type EnumError<Message extends string> = {
	readonly [K in Message]: never;
};

type NarrowSymbol<V> =
	[V] extends [never]
		? never
		: V extends symbol
			? symbol extends V
				? never
				: V
			: never;

type UniqueSymbolValues<T> = {
	[K in keyof T]-?: NarrowSymbol<T[K]>;
}[keyof T];

type EnumValidation<T> =
	T extends abstract new (...args: unknown[]) => unknown
		? EnumError<"Enum classes must not expose a public constructor">
		: [UniqueSymbolValues<T>] extends [never]
			? EnumError<"Enum classes must define at least one unique symbol member">
			: true;

type EnumConstraint<T> = {
	[K in keyof T]:
	K extends "prototype"
		? EnumValidation<T> extends true
			? T[K]
			: EnumValidation<T>
		: T[K];
};

export type EnumType<
	T extends { readonly prototype: unknown } & EnumConstraint<T>,
> = UniqueSymbolValues<T>;


export abstract class EnumBase {
	protected constructor() {}
}
