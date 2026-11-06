import assert from "node:assert/strict";
import test from "node:test";

import { AddonURIS } from "#utils";
import { isStackMatchGroups, megaRex, SuperReplacer } from "#/app/services/webapp/api/gmod-error-handler.js";

// -----------------------------------------------------------------------------
// Deterministic test fixtures
// -----------------------------------------------------------------------------

const ADDON_URL = "https://example.test/addons/testaddon/";
const MTA_URL = "https://example.test/addons/mta/";
const MTA_GAMEMODE_URL = "https://example.test/gamemodes/mta/";

const STEAM_ID = "STEAM_0:1:42";
const STEAM_URL =
	"https://steamcommunity.com/profiles/76561197960265813";

const EVEN_STEAM_ID = "STEAM_0:0:42";
const EVEN_STEAM_URL =
	"https://steamcommunity.com/profiles/76561197960265812";

type TestGroups = Record<string, string | undefined>;

type TestCase = {
	name: string;
	input: string;
	expected: string;
};

const addonURIs = AddonURIS as unknown as Record<
	string,
  string | undefined
>;

/**
 * Temporarily install deterministic addon mappings.
 *
 * All callbacks using this helper must be synchronous. Original property
 * descriptors are restored even when an assertion or the replacer throws.
 */
function withAddonURIs(
	overrides: Record<string, string | undefined>,
	run: () => void,
): void {
	const saved = new Map<string, PropertyDescriptor | undefined>();

	try {
		for (const [key, value] of Object.entries(overrides)) {
			saved.set(key, Object.getOwnPropertyDescriptor(addonURIs, key));

			Object.defineProperty(addonURIs, key, {
				configurable: true,
				enumerable: true,
				writable: true,
				value,
			});
		}

		run();
	} finally {
		for (const [key, descriptor] of saved) {
			if (descriptor === undefined) {
				delete addonURIs[key];
			} else {
				Object.defineProperty(addonURIs, key, descriptor);
			}
		}
	}
}

function withDefaultAddonURIs(run: () => void): void {
	withAddonURIs(
		{
			testaddon: ADDON_URL,
			unknownaddon: undefined,
			mta: MTA_URL,
			mta_gamemode: MTA_GAMEMODE_URL,
		},
		run,
	);
}

/**
 * Clone the actual production RegExp.
 *
 * This preserves its source and flags while preventing lastIndex state
 * from leaking between tests.
 */
function freshRegex(): RegExp {
	return new RegExp(megaRex.source, megaRex.flags);
}

function replace(input: string): string {
	return input.replaceAll(freshRegex(), SuperReplacer);
}

/** Obtain a complete frame and its actual positional and named captures. */
function matchFrame(input: string): RegExpExecArray {
	const match = freshRegex().exec(input);
	assert.ok(match, `Expected a RegExp match for ${JSON.stringify(input)}`);
	assert.equal(match.index, 0);
	assert.equal(match[0], input, "Expected the complete input to match");
	assert.ok(isStackMatchGroups(match.groups));
	return match;
}

function assertGroups(
	input: string,
	expected: TestGroups,
): void {
	const match = freshRegex().exec(input);

	assert.ok(match, `Expected a RegExp match for ${JSON.stringify(input)}`);
	assert.ok(match.groups, "Expected named capture groups");

	assert.equal(match.index, 0);
	assert.equal(match[0], input, "Expected the complete input to match");

	for (const [name, value] of Object.entries(expected)) {
		assert.equal(
			match.groups[name],
			value,
			`Unexpected capture group: ${name}`,
		);
	}
}

// -----------------------------------------------------------------------------
// Production RegExp contract
// -----------------------------------------------------------------------------

test("isStackMatchGroups accepts required captures without optional captures", () => {
	const groups = freshRegex().exec("1. callback - :-1")?.groups;
	assert.ok(groups);
	assert.equal(groups.fpath, ":-1");
	assert.equal(groups.path, undefined);
	assert.equal(groups.steamid, undefined);
	assert.equal(isStackMatchGroups(groups), true);
});

test("isStackMatchGroups accepts production capture groups", () => {
	for (const input of [
		"1. callback - [C]:-1",
		"2. callback - lua/testaddon/init.lua:7",
		`3. callback - [${STEAM_ID}]Alice:7`,
		"4. callback - RunString<0:1:42|Alice><script.lua>:19",
	]) {
		assert.equal(isStackMatchGroups(freshRegex().exec(input)?.groups), true);
	}
});

test("isStackMatchGroups rejects absent named groups", () => {
	assert.equal(isStackMatchGroups(freshRegex().exec("not a stack frame")?.groups), false);
	const match = /callback/.exec("callback");
	assert.ok(match);
	assert.equal(isStackMatchGroups(match.groups), false);
});

test("isStackMatchGroups rejects missing or unmatched required captures", () => {
	const required = ["fn", "fpath", "lineno", "stacknr"];
	for (const missing of required) {
		for (const unmatched of [false, true]) {
			const source = required.map(key => {
				if (key === missing) return unmatched ? `(?<${key}>y)?` : "";
				return `(?<${key}>x)`;
			}).join("");
			const match = new RegExp(`^${source}$`).exec("xxx");
			assert.ok(match?.groups);
			assert.equal(match.groups[missing], undefined);
			assert.equal(isStackMatchGroups(match.groups), false);
		}
	}
});

const missingRequiredCaptureCases = [
	{ capture: "stacknr", input: ". callback - :7" },
	{ capture: "fn", input: "1.  - :7" },
	{ capture: "fpath", input: "1. callback - " },
	{ capture: "lineno", input: "1. callback - :" },
];

for (const { capture, input } of missingRequiredCaptureCases) {
	test(`megaRex does not invoke SuperReplacer when ${capture} is missing`, () => {
		let calls = 0;
		const replacer = (match: string, ...args: unknown[]): string => {
			calls++;
			return SuperReplacer(match, ...args);
		};

		// Positive control: the complete frame must match and pass the guard.
		assert.equal(
			"1. callback - :7".replaceAll(freshRegex(), replacer),
			"1. callback - undefined:7",
		);
		assert.equal(calls, 1);
		calls = 0;

		assert.equal(freshRegex().exec(input), null);
		assert.equal(input.replaceAll(freshRegex(), replacer), input);
		assert.equal(calls, 0, `Replacer must not run without ${capture}`);
	});
}

test("megaRex is global, as required by replaceAll", () => {
	assert.equal(megaRex.global, true);
});

test("megaRex captures a full Steam ID and nickname", () => {
	assertGroups(`12. callback - [${STEAM_ID}]Alice:7`, {
		stacknr: "12",
		fn: "callback",
		steamid: STEAM_ID,
		steamnick: "Alice",
		partialsteamid: undefined,
		path: undefined,
		engine: undefined,
		lineno: "7",
	});
});

test("megaRex captures a runnable, partial Steam ID, and filename", () => {
	assertGroups(
		"2. callback - RunString<0:1:42|Alice><script.lua>:19",
		{
			stacknr: "2",
			fn: "callback",
			runnables: "RunString",
			partialsteamid: "0:1:42",
			nick: "Alice",
			rfilename: "script.lua",
			cmdname: undefined,
			cmdrealm: undefined,
			lineno: "19",
		},
	);
});

test("megaRex captures a command name and realm", () => {
	assertGroups(
		"3. callback - LuaCmd<0:1:42|Alice><say:server>:5",
		{
			runnables: "LuaCmd",
			partialsteamid: "0:1:42",
			nick: "Alice",
			rfilename: undefined,
			cmdname: "say",
			cmdrealm: "server",
			lineno: "5",
		},
	);
});

test("megaRex captures addon paths", () => {
	assertGroups(
		"4. callback - lua/testaddon/sub/init.lua:23",
		{
			path: "lua/testaddon/sub/init.lua",
			addon: "testaddon",
			filename: "init",
			ext: "lua",
			lineno: "23",
		},
	);
});

test("megaRex captures engine frames and negative line numbers", () => {
	assertGroups("5. callback - [C]:-1", {
		engine: "[C]",
		path: undefined,
		lineno: "-1",
	});
});

// -----------------------------------------------------------------------------
// End-to-end replacement using the production RegExp
// -----------------------------------------------------------------------------

const replacementCases: TestCase[] = [
	{
		name: "formats a full Steam ID",
		input: `1. fn - [${STEAM_ID}]Alice:7`,
		expected: `1. fn - [[${STEAM_ID}]Alice](${STEAM_URL}):7`,
	},
	{
		name: "converts the even Steam account component correctly",
		input: `1. fn - [${EVEN_STEAM_ID}]Alice:7`,
		expected:
      `1. fn - [[${EVEN_STEAM_ID}]Alice](${EVEN_STEAM_URL}):7`,
	},
	{
		name: "preserves spaces in a Steam nickname",
		input: `1. fn - [${STEAM_ID}]Alice Example:7`,
		expected:
      `1. fn - [[${STEAM_ID}]Alice Example](${STEAM_URL}):7`,
	},
	{
		name: "preserves colons inside a Steam nickname",
		input: `1. fn - [${STEAM_ID}]Alice:Admin:7`,
		expected:
      `1. fn - [[${STEAM_ID}]Alice:Admin](${STEAM_URL}):7`,
	},
	{
		name: "does not escape Markdown in Steam nicknames",
		input: `1. fn - [${STEAM_ID}][Alice](example):7`,
		expected:
      `1. fn - [[${STEAM_ID}][Alice](example)](${STEAM_URL}):7`,
	},
	{
		name: "preserves Unicode nicknames",
		input: `1. fn - [${STEAM_ID}]玩家 🦊:7`,
		expected:
      `1. fn - [[${STEAM_ID}]玩家 🦊](${STEAM_URL}):7`,
	},
	{
		name: "formats a partial Steam ID and filename",
		input: "1. fn - <0:1:42|Alice><script.lua>:7",
		expected:
      `1. fn - <[0:1:42 |Alice](${STEAM_URL})><script.lua>:7`,
	},
	{
		name: "preserves runnable filename paths and spaces",
		input: "1. fn - <0:1:42|Alice><folder/my script.lua>:7",
		expected:
      `1. fn - <[0:1:42 |Alice](${STEAM_URL})>` +
      "<folder/my script.lua>:7",
	},
	{
		name: "formats a partial Steam ID and command",
		input: "1. fn - <0:1:42|Alice><say:server>:7",
		expected:
      `1. fn - <[0:1:42 |Alice](${STEAM_URL})><say:server>:7`,
	},
	{
		name: "preserves a missing partial-Steam-ID location as undefined fields",
		input: "1. fn - <0:1:42|Alice>:7",
		expected:
      `1. fn - <[0:1:42 |Alice](${STEAM_URL})>` +
      "<undefined:undefined>:7",
	},
	{
		name: "links a known Lua addon",
		input: "1. fn - lua/testaddon/init.lua:7",
		expected:
      "1. fn - [lua/testaddon/init.lua]" +
      `(${ADDON_URL}lua/testaddon/init.lua#L7):7`,
	},
	{
		name: "links nested Lua paths",
		input: "1. fn - lua/testaddon/a/b/init.lua:7",
		expected:
      "1. fn - [lua/testaddon/a/b/init.lua]" +
      `(${ADDON_URL}lua/testaddon/a/b/init.lua#L7):7`,
	},
	{
		name: "links known gamemode paths",
		input: "1. fn - gamemodes/testaddon/gamemode/init.lua:7",
		expected:
      "1. fn - [gamemodes/testaddon/gamemode/init.lua]" +
      `(${ADDON_URL}gamemodes/testaddon/gamemode/init.lua#L7):7`,
	},
	{
		name: "leaves unknown addon paths unlinked",
		input: "1. fn - lua/unknownaddon/init.lua:7",
		expected: "1. fn - lua/unknownaddon/init.lua:7",
	},
	{
		name: "uses the regular mta mapping for Lua paths",
		input: "1. fn - lua/mta/init.lua:7",
		expected:
      "1. fn - [lua/mta/init.lua]" +
      `(${MTA_URL}lua/mta/init.lua#L7):7`,
	},
	{
		name: "preserves the original mta gamemode URL lookup",
		input: "1. fn - gamemodes/mta/gamemode/init.lua:7",
		expected:
      "1. fn - [gamemodes/mta/gamemode/init.lua]" +
      `(${MTA_URL}gamemodes/mta/gamemode/init.lua#L7):7`,
	},
	{
		name: "preserves engine frames",
		input: "1. fn - [C]:7",
		expected: "1. fn - [C]:7",
	},
	{
		name: "preserves negative engine line numbers",
		input: "1. fn - [C]:-1",
		expected: "1. fn - [C]:-1",
	},
	{
		name: "preserves a negative line number in a linked path",
		input: "1. fn - lua/testaddon/init.lua:-1",
		expected:
      "1. fn - [lua/testaddon/init.lua]" +
      `(${ADDON_URL}lua/testaddon/init.lua#L-1):-1`,
	},
	{
		name: "preserves zero line numbers",
		input: "1. fn - lua/testaddon/init.lua:0",
		expected:
      "1. fn - [lua/testaddon/init.lua]" +
      `(${ADDON_URL}lua/testaddon/init.lua#L0):0`,
	},
	{
		name: "preserves leading zeroes in stack and line numbers",
		input: "001. fn - lua/testaddon/init.lua:0007",
		expected:
      "001. fn - [lua/testaddon/init.lua]" +
      `(${ADDON_URL}lua/testaddon/init.lua#L0007):0007`,
	},
	{
		name: "does not numerically round large line numbers",
		input: "1. fn - [C]:9007199254740993",
		expected: "1. fn - [C]:9007199254740993",
	},
	{
		name: "preserves non-whitespace function names verbatim",
		input: "1. object:method<T> - lua/testaddon/init.lua:7",
		expected:
      "1. object:method<T> - [lua/testaddon/init.lua]" +
      `(${ADDON_URL}lua/testaddon/init.lua#L7):7`,
	},
	{
		name: "preserves missing frame information as undefined",
		input: "1. fn - :7",
		expected: "1. fn - undefined:7",
	},
	{
		name: "discards a filename when no partial Steam ID exists",
		input: "1. fn - <script.lua>:7",
		expected: "1. fn - undefined:7",
	},
	{
		name: "discards a command when no partial Steam ID exists",
		input: "1. fn - <say:server>:7",
		expected: "1. fn - undefined:7",
	},
];

for (const { name, input, expected } of replacementCases) {
	test(`SuperReplacer: ${name}`, () => {
		withDefaultAddonURIs(() => {
			assert.equal(replace(input), expected);
		});
	});
}

for (const runnable of ["RunString", "LuaCmd", "LUACMD"]) {
	test(`SuperReplacer: removes the ${runnable} prefix`, () => {
		withDefaultAddonURIs(() => {
			assert.equal(
				replace(
					`1. fn - ${runnable}<0:1:42|Alice><script.lua>:7`,
				),
				`1. fn - <[0:1:42 |Alice](${STEAM_URL})><script.lua>:7`,
			);
		});
	});

	test(`SuperReplacer: handles ${runnable} without identity information`, () => {
		assert.equal(
			replace(`1. fn - ${runnable}:7`),
			"1. fn - undefined:7",
		);
	});
}

// -----------------------------------------------------------------------------
// Multiple matches, surrounding text, and replacement-string hazards
// -----------------------------------------------------------------------------

test("SuperReplacer replaces every frame in a multiline stack trace", () => {
	withDefaultAddonURIs(() => {
		const input = [
			"Error: example",
			`1. first - [${STEAM_ID}]Alice:7`,
			"2. second - lua/testaddon/init.lua:9",
			"3. third - [C]:-1",
			"End of trace",
		].join("\n");

		const expected = [
			"Error: example",
			`1. first - [[${STEAM_ID}]Alice](${STEAM_URL}):7`,
			"2. second - [lua/testaddon/init.lua]" +
        `(${ADDON_URL}lua/testaddon/init.lua#L9):9`,
			"3. third - [C]:-1",
			"End of trace",
		].join("\n");

		assert.equal(replace(input), expected);
	});
});

test("SuperReplacer preserves CRLF line endings", () => {
	withDefaultAddonURIs(() => {
		const input =
			"Header\r\n1. fn - lua/testaddon/init.lua:7\r\nFooter";

		const expected =
			"Header\r\n" +
      "1. fn - [lua/testaddon/init.lua]" +
      `(${ADDON_URL}lua/testaddon/init.lua#L7):7\r\n` +
      "Footer";

		assert.equal(replace(input), expected);
	});
});

test("SuperReplacer replaces multiple non-greedy frames on one line", () => {
	withDefaultAddonURIs(() => {
		assert.equal(
			replace(
				"1. first - lua/testaddon/init.lua:7 | " +
        "2. second - [C]:-1",
			),
			"1. first - [lua/testaddon/init.lua]" +
        `(${ADDON_URL}lua/testaddon/init.lua#L7):7 | ` +
        "2. second - [C]:-1",
		);
	});
});

test("SuperReplacer preserves text before and after a match", () => {
	withDefaultAddonURIs(() => {
		assert.equal(
			replace("prefix: 1. fn - lua/testaddon/init.lua:7 suffix"),
			"prefix: " +
        "1. fn - [lua/testaddon/init.lua]" +
        `(${ADDON_URL}lua/testaddon/init.lua#L7):7 suffix`,
		);
	});
});

test("SuperReplacer preserves literal replacement-token characters", () => {
	const nick = "$& $$ $1 $` $'";

	assert.equal(
		replace(`1. fn - [${STEAM_ID}]${nick}:7`),
		`1. fn - [[${STEAM_ID}]${nick}](${STEAM_URL}):7`,
	);
});

test("SuperReplacer works with the same production RegExp repeatedly", () => {
	const previousLastIndex = megaRex.lastIndex;

	try {
		megaRex.lastIndex = 0;

		for (let attempt = 0; attempt < 3; attempt++) {
			assert.equal(
				`1. fn - [${STEAM_ID}]Alice:7`.replaceAll(
					megaRex,
					SuperReplacer,
				),
				`1. fn - [[${STEAM_ID}]Alice](${STEAM_URL}):7`,
			);
		}
	} finally {
		megaRex.lastIndex = previousLastIndex;
	}
});

// -----------------------------------------------------------------------------
// Inputs that the production RegExp does not recognize
// -----------------------------------------------------------------------------

const unchangedInputs = [
	"",
	"ordinary text",
	"1. fn",
	"1. fn - lua/testaddon/init.lua",
	"1. fn - lua/testaddon/init.lua:not-a-number",
	"1. fn - lua/testaddon/init.lua:+7",
	"1. fn - lua/testaddon/init.lua:--7",
	"1. fn - lua/testaddon/init.txt:7",
	"1. fn - lua/testaddon/init.LUA:7",
	"1. fn - LUA/testaddon/init.lua:7",
	"1. fn - addons/testaddon/init.lua:7",
	"1. fn - lua/init.lua:7",
	"1.fn - lua/testaddon/init.lua:7",
	"1. fn- lua/testaddon/init.lua:7",
	"1. fn -lua/testaddon/init.lua:7",
	"1. two words - lua/testaddon/init.lua:7",
];

for (const input of unchangedInputs) {
	test(`SuperReplacer leaves unmatched input unchanged: ${JSON.stringify(input)}`, () => {
		withDefaultAddonURIs(() => {
			assert.equal(freshRegex().exec(input), null);
			assert.equal(replace(input), input);
		});
	});
}

test("megaRex accepts the integer prefix of a decimal-looking line number", () => {
	withDefaultAddonURIs(() => {
		assert.equal(
			replace("1. fn - lua/testaddon/init.lua:7.5"),
			"1. fn - [lua/testaddon/init.lua]" +
        `(${ADDON_URL}lua/testaddon/init.lua#L7):7.5`,
		);
	});
});

// -----------------------------------------------------------------------------
// Direct callback behavior and branch precedence
// -----------------------------------------------------------------------------

test("SuperReplacer reads the final callback argument as named groups", () => {
	const input = "1. fn - [C]:7";
	const match = matchFrame(input);
	assert.equal(
		SuperReplacer(match[0], ...match.slice(1), match.index, input, match.groups),
		"1. fn - [C]:7",
	);
});

test("SuperReplacer preserves frame-like text consumed by the greedy Steam nickname", () => {
	const nick = "Full<0:0:42|Partial><script.lua>[C]lua/testaddon/init.lua";
	const input = `1. fn - [${STEAM_ID}]${nick}:7`;
	const match = matchFrame(input);
	assert.equal(match.groups?.steamnick, nick);
	assert.equal(match.groups?.partialsteamid, undefined);
	assert.equal(match.groups?.path, undefined);
	assert.equal(match.groups?.engine, undefined);
	assert.equal(replace(input), `1. fn - [[${STEAM_ID}]${nick}](${STEAM_URL}):7`);
});

test("SuperReplacer gives partial Steam IDs precedence over paths and engine", () => {
	withDefaultAddonURIs(() => {
		const input = "1. fn - <0:1:42|Alice><script.lua>[C]lua/testaddon/init.lua:7";
		const match = matchFrame(input);
		assert.equal(match.groups?.rfilename, "script.lua");
		assert.equal(match.groups?.path, "lua/testaddon/init.lua");
		assert.equal(match.groups?.engine, "[C]");
		assert.equal(replace(input), `1. fn - <[0:1:42 |Alice](${STEAM_URL})><script.lua>:7`);
	});
});

test("SuperReplacer gives runnable filenames precedence over commands", () => {
	const input = "1. fn - <0:1:42|Alice><script.lua><say:server>:7";
	const match = matchFrame(input);
	assert.equal(match.groups?.rfilename, "script.lua");
	assert.equal(match.groups?.cmdname, "say");
	assert.equal(match.groups?.cmdrealm, "server");
	assert.equal(replace(input), `1. fn - <[0:1:42 |Alice](${STEAM_URL})><script.lua>:7`);
});

test("SuperReplacer gives paths precedence over engine information", () => {
	withDefaultAddonURIs(() => {
		const input = "1. fn - [C]lua/unknownaddon/init.lua:7";
		const match = matchFrame(input);
		assert.equal(match.groups?.path, "lua/unknownaddon/init.lua");
		assert.equal(match.groups?.engine, "[C]");
		assert.equal(replace(input), "1. fn - lua/unknownaddon/init.lua:7");
	});
});

test("SuperReplacer does not mutate named capture groups", () => {
	withDefaultAddonURIs(() => {
		const input = "1. fn - lua/testaddon/init.lua:7";
		const match = matchFrame(input);
		const groups = Object.freeze(match.groups);
		const before = { ...groups };

		assert.equal(
			SuperReplacer(match[0], ...match.slice(1), match.index, input, groups),
			"1. fn - [lua/testaddon/init.lua]" +
				`(${ADDON_URL}lua/testaddon/init.lua#L7):7`,
		);

		assert.deepEqual({ ...groups }, before);
	});
});

// -----------------------------------------------------------------------------
// Addon URL behavior, including original mta lookup inconsistencies
// -----------------------------------------------------------------------------

test("SuperReplacer treats an empty addon URL as unavailable", () => {
	withAddonURIs({ testaddon: "" }, () => {
		assert.equal(
			replace("1. fn - lua/testaddon/init.lua:7"),
			"1. fn - lua/testaddon/init.lua:7",
		);
	});
});

test("SuperReplacer concatenates addon URLs without adding a slash", () => {
	withAddonURIs(
		{ testaddon: "https://example.test/no-trailing-slash" },
		() => {
			assert.equal(
				replace("1. fn - lua/testaddon/init.lua:7"),
				"1. fn - [lua/testaddon/init.lua]" +
          "(https://example.test/no-trailing-slash" +
          "lua/testaddon/init.lua#L7):7",
			);
		},
	);
});

test("SuperReplacer requires mta_gamemode for mta gamemode links", () => {
	withAddonURIs(
		{
			mta: MTA_URL,
			mta_gamemode: undefined,
		},
		() => {
			assert.equal(
				replace("1. fn - gamemodes/mta/gamemode/init.lua:7"),
				"1. fn - gamemodes/mta/gamemode/init.lua:7",
			);
		},
	);
});

test("SuperReplacer preserves undefined URL prefix when only mta_gamemode exists", () => {
	withAddonURIs(
		{
			mta: undefined,
			mta_gamemode: MTA_GAMEMODE_URL,
		},
		() => {
			assert.equal(
				replace("1. fn - gamemodes/mta/gamemode/init.lua:7"),
				"1. fn - [gamemodes/mta/gamemode/init.lua]" +
          "(undefinedgamemodes/mta/gamemode/init.lua#L7):7",
			);
		},
	);
});

test("SuperReplacer preserves empty URL prefix when mta is empty", () => {
	withAddonURIs(
		{
			mta: "",
			mta_gamemode: MTA_GAMEMODE_URL,
		},
		() => {
			assert.equal(
				replace("1. fn - gamemodes/mta/gamemode/init.lua:7"),
				"1. fn - [gamemodes/mta/gamemode/init.lua]" +
          "(gamemodes/mta/gamemode/init.lua#L7):7",
			);
		},
	);
});

test("SuperReplacer does not require mta_gamemode for mta Lua paths", () => {
	withAddonURIs(
		{
			mta: MTA_URL,
			mta_gamemode: undefined,
		},
		() => {
			assert.equal(
				replace("1. fn - lua/mta/init.lua:7"),
				"1. fn - [lua/mta/init.lua]" +
          `(${MTA_URL}lua/mta/init.lua#L7):7`,
			);
		},
	);
});
