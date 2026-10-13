import assert from "node:assert/strict";
import test from "node:test";
import "#/lib/regex.js";

const RGX_GLOB_REGEX = /^\/(.*)\/\w$/;

function makeRegexPair(a: RegExp, b: string) {
	const amatch = RGX_GLOB_REGEX.exec(a.toString());
	assert.ok(amatch);
	assert.strictEqual(amatch[1], b);
	return {regex: a, strings: [b, a.flags] as const};
}

test("String.concord.matchAll without groups resolves like String.matchAll", () => {
	const input = "aba abb";

	const R = makeRegexPair(/ab./g, "ab.");

	const actual = [...input.concord.matchAll(...R.strings)].map(match => ({
		match: match[0],
		index: match.index,
	}));
	const expected = [...input.matchAll(R.regex)].map(match => ({
		match: match[0],
		index: match.index,
	}));

	assert.deepEqual(actual, expected);
});

test("String.concord.matchAll with groups resolves like String.matchAll", () => {
	const input = "a=1 b=2 c=3";

	const R = makeRegexPair(/(?<key>\w)=(?<value>\d)/g, "(?<key>\\w)=(?<value>\\d)");

	const actual = [...input.concord.matchAll(...R.strings)].map(match => ({
		match: match.groups,
		index: match.index,
	}));
	const expected = [...input.matchAll(R.regex)].map(match => ({
		match: match.groups,
		index: match.index,
	}));
	
	assert.deepEqual(actual, expected);
});

test("String.concord.matchAll throws on non-global regex", () => {
	// @ts-expect-error flags must include g
	assert.throws(() => "abc".concord.matchAll("a", "i"));
});

test("String.concord.matchAll doesn't throw on global regex with multiple flags", () => {
	assert.doesNotThrow(() => "abc".concord.matchAll("a", "gi"));
});

test("String.concord.matchAll exposes named groups in typings", () => {
	const match = [...("a=1").concord.matchAll("a=(?<val>\\d)", "g")][0];
	assert.ok(match);
	const value: string = match.groups.val;
	assert.strictEqual(value, "1");
});

test("String.concord.matchAll exposes numeric indexes in typings", () => {
	const match = [...("a=1").concord.matchAll("a=(\\d)", "g")][0];
	assert.ok(match);
	const value: string = match[1];
	assert.strictEqual(value, "1");
});

test("String.concord.matchAll omits non-existent numeric indexes in typings", () => {
	const match = [...("a=1").concord.matchAll("a=(\\d)", "g")][0];
	assert.ok(match);
	// TODO: enable this after making tsconfig more strict: // @ts-expect-error index 2 should not exist for a single capture group
	const value = match[2];
	assert.strictEqual(value, undefined);
});

