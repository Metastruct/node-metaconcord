import assert from "node:assert/strict";
import { mock, test, type TestContext } from "node:test";
import SQLite from "better-sqlite3";
import { Kysely, SqliteDialect } from "kysely";

import { migrateToLatest } from "#lib/kyselyMigrator";
import type { DB } from "#/generated/LocalDBTypes.js";

mock.module("#utils", {
	exports: { logger: () => ({ error() {} }) },
});
const { MarkovChain } = await import("#/app/services/Markov.js");

async function fixture(t: TestContext, messages: string[] = []) {
	const sqlite = new SQLite(":memory:");
	const db = new Kysely<DB>({ dialect: new SqliteDialect({ database: sqlite }) });
	t.after(() => db.destroy());

	await migrateToLatest(db, { info: ()=>{}, error: ()=>{}, debug: ()=>{} });

	if (messages.length > 0) {
		await db.insertInto("markov").values(messages.map(message => ({ message }))).execute();
	}
	return { chain: new MarkovChain(db), db, sqlite };
}

test("queryDB returns null for an empty database", async t => {
	const { chain } = await fixture(t);
	for (const input of [[], [""], [" ", "\t"], ["hello"], ["hello", "world"]]) {
		assert.equal(await chain.queryDB(input), null, JSON.stringify(input));
	}
});

test("queryDB samples any stored message for an empty or whitespace-only chain", async t => {
	for (const message of ["hello world", "hello", "", " ".repeat(3)]) {
		await t.test(JSON.stringify(message), async t => {
			const { chain } = await fixture(t, [message]);
			for (const input of [[], [""], ["", ""], [" \t\n"], [" ", "\t"]]) {
				assert.equal(await chain.queryDB(input), message, JSON.stringify(input));
			}
		});
	}
});

type QueryCase = {
	name: string;
	message: string;
	input: string[];
	matches: boolean;
};

const cases: QueryCase[] = [
	{ name: "word at the start", message: "hello world", input: ["hello"], matches: true },
	{ name: "word in the middle", message: "say hello world", input: ["hello"], matches: true },
	{ name: "single-character prefix and continuation", message: "a hello b", input: ["hello"], matches: true },
	{ name: "multiword chain at the start", message: "hello world again", input: ["hello", "world"], matches: true },
	{ name: "multiword chain in the middle", message: "say hello world again", input: ["hello", "world"], matches: true },
	{ name: "a chain longer than the generation default depth", message: "one two three four five six", input: ["one", "two", "three", "four", "five"], matches: true },
	{ name: "missing word", message: "hello world", input: ["missing"], matches: false },
	{ name: "empty stored message", message: "", input: ["hello"], matches: false },
	{ name: "whole message is not a continuation", message: "hello world", input: ["hello", "world"], matches: false },
	{ name: "terminal word", message: "say hello", input: ["hello"], matches: false },
	{ name: "terminal multiword chain", message: "say hello world", input: ["hello", "world"], matches: false },
	{ name: "words must be adjacent", message: "hello lovely world again", input: ["hello", "world"], matches: false },
	{ name: "word order matters", message: "world hello again", input: ["hello", "world"], matches: false },
	{ name: "no matching word suffix", message: "shelloworld again", input: ["hello"], matches: false },
	{ name: "no matching word prefix", message: "helloish again", input: ["hello"], matches: false },
	{ name: "no matching middle-word substring", message: "say shelloworld again", input: ["hello"], matches: false },
	{ name: "ASCII case-insensitive SQL matching", message: "Say HELLO World", input: ["hello"], matches: true },
	{ name: "uppercase input", message: "hello world again", input: ["HELLO", "WORLD"], matches: true },
	{ name: "non-ASCII matching is not case-folded", message: "Äpfel sind lecker", input: ["äpfel"], matches: false },
	{ name: "matching non-ASCII text", message: "Äpfel sind lecker", input: ["Äpfel"], matches: true },
	{ name: "punctuation is part of a word", message: "hello, world again", input: ["hello"], matches: false },
	{ name: "explicit punctuation matches", message: "hello, world again", input: ["hello,"], matches: true },
	{ name: "apostrophes are bound safely", message: "don't stop now", input: ["don't"], matches: true },
	{ name: "SQL-looking input stays a parameter", message: "hello world", input: ["' OR 1=1 --"], matches: false },
	{ name: "percent is a LIKE wildcard", message: "hello world", input: ["h%o"], matches: true },
	{ name: "underscore is a LIKE wildcard", message: "hello world", input: ["h_llo"], matches: true },
	{ name: "underscore matches exactly one character", message: "helo world", input: ["h_llo"], matches: false },
	{ name: "backslash does not escape a LIKE wildcard", message: "hello world", input: ["h\\%o"], matches: false },
	{ name: "tabs are not word boundaries", message: "hello\tworld again", input: ["hello"], matches: false },
	{ name: "newlines are not word boundaries", message: "hello\nworld again", input: ["hello"], matches: false },
	{ name: "chain whitespace is not normalized", message: "hello  world again", input: ["hello", "world"], matches: false },
	{ name: "input whitespace is not trimmed", message: "hello world", input: [" hello"], matches: false },
	{ name: "empty chain elements preserve extra spaces", message: "hello  world again", input: ["hello", "", "world"], matches: true },
	{ name: "one leading space is insufficient for the middle pattern", message: " hello world", input: ["hello"], matches: false },
	{ name: "two leading spaces satisfy the middle pattern", message: "  hello world", input: ["hello"], matches: true },
	{ name: "a lone trailing space is insufficient", message: "hello ", input: ["hello"], matches: false },
	{ name: "two trailing spaces count as a continuation", message: "hello  ", input: ["hello"], matches: true },
	{ name: "an earlier match is rejected if the message also ends in the chain", message: "hello world hello", input: ["hello"], matches: false },
	{ name: "multiword repeated terminal chain is rejected", message: "hello world again hello world", input: ["hello", "world"], matches: false },
	{ name: "suffix rejection is case-sensitive", message: "hello world HELLO", input: ["hello"], matches: true },
	{ name: "suffix rejection also catches a non-word suffix", message: "hello world shello", input: ["hello"], matches: false },
];

for (const { name, message, input, matches } of cases) {
	test(`queryDB: ${name}`, async t => {
		const { chain } = await fixture(t, [message]);
		assert.equal(await chain.queryDB(input), matches ? message : null);
	});
}

test("queryDB selects only eligible messages from a mixed corpus", async t => {
	const eligible = new Set(["hello world", "say hello again", "HELLO there friend"]);
	const { chain } = await fixture(t, [
		...eligible,
		"hello",
		"say hello",
		"helloish world",
		"unrelated message",
		"",
	]);
	for (let attempt = 0; attempt < 20; attempt++) {
		const result = await chain.queryDB(["hello"]);
		assert.ok(result !== null && eligible.has(result), JSON.stringify(result));
	}
});

test("queryDB samples only stored messages for an empty chain with multiple rows", async t => {
	const messages = ["hello", "another message", "", " ".repeat(3)];
	const { chain } = await fixture(t, messages);
	for (let attempt = 0; attempt < 20; attempt++) {
		const result = await chain.queryDB([]);
		assert.ok(result !== null && messages.includes(result), JSON.stringify(result));
	}
});

test("queryDB does not retry when the selected row fails the suffix check", async t => {
	const { chain, sqlite } = await fixture(t, ["hello again hello", "hello world"]);
	// Control SQLite's random(), not Math.random(), to select the first inserted
	// row reproducibly. SQL must select it before the JS suffix check rejects it.
	let rank = 0;
	sqlite.function("random", () => rank++);
	assert.equal(await chain.queryDB(["hello"]), null);
});

test("learn normalizes whitespace and queryDB returns the persisted message", async t => {
	const { chain, db } = await fixture(t);
	await chain.learn(" \tHello\n\nworld\t again  ");
	assert.deepEqual(await db.selectFrom("markov").select("message").execute(), [
		{ message: "Hello world again" },
	]);
	assert.equal(await chain.queryDB(["hello", "world"]), "Hello world again");
	assert.equal(await chain.queryDB(["again"]), null);
});
