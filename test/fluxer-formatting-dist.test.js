import assert from "node:assert/strict";
import test from "node:test";
import {
	componentEmbeds,
	componentFallbackText,
	discordEmojiCdnUrl,
	normalizeEmbeds,
	rewriteEmojiMarkup,
} from "../dist/app/services/fluxer/index.js";

test("generated Klipy previews are left for the destination to unfurl", () => {
	const url = "https://klipy.com/gifs/example";
	assert.deepEqual(
		normalizeEmbeds(
			[
				{
					type: "gifv",
					url,
					provider: { name: "Klipy" },
					thumbnail: { url: "https://static.klipy.com/preview.webp" },
					video: { url: "https://static.klipy.com/video.mp4" },
				},
			],
			url
		),
		[]
	);
});

test("authored embeds and commit component containers remain relayable", () => {
	assert.equal(
		normalizeEmbeds([{ type: "rich", description: "Permanent" }])[0].description,
		"Permanent"
	);
	const components = [
		{
			type: 17,
			accent_color: 3289725,
			components: [
				{
					type: 9,
					components: [{ type: 10, content: "### Commit title" }],
					accessory: { media: { url: "https://example.com/avatar.png" } },
				},
				{ type: 10, content: "```diff\n+ fixed\n```" },
			],
		},
	];
	const embeds = componentEmbeds(components);
	assert.equal(embeds.length, 1);
	assert.match(embeds[0].description, /Commit title/);
	assert.equal(embeds[0].thumbnail.url, "https://example.com/avatar.png");
	assert.match(componentFallbackText(components), /fixed/);
});

test("rewriteEmojiMarkup maps known emojis and falls back otherwise", () => {
	const lookup = id => (id === "1001" ? "9001" : undefined);
	assert.equal(rewriteEmojiMarkup("hi <:pet:1001> there", lookup), "hi <:pet:9001> there");
	assert.equal(rewriteEmojiMarkup("<a:wave:1001>", lookup), "<a:wave:9001>");
	assert.equal(rewriteEmojiMarkup("x <:unknown:5000> y", lookup), "x :unknown: y");
	assert.equal(rewriteEmojiMarkup("no emoji here", lookup), "no emoji here");
});

test("rewriteEmojiMarkup reports unmapped emojis via onUnmapped", () => {
	const lookup = id => (id === "1001" ? "9001" : undefined);
	const unmapped = [];
	const result = rewriteEmojiMarkup(
		"<:pet:1001> <:external:5000> <a:animated:6000>",
		lookup,
		emoji => unmapped.push(emoji)
	);
	assert.equal(result, "<:pet:9001> :external: :animated:");
	assert.deepEqual(unmapped, [
		{ id: "5000", name: "external", animated: false },
		{ id: "6000", name: "animated", animated: true },
	]);
	assert.deepEqual(
		rewriteEmojiMarkup("only <:pet:1001>", lookup, emoji => unmapped.push(emoji)),
		"only <:pet:9001>"
	);
	assert.equal(unmapped.length, 2);
});

test("discordEmojiCdnUrl picks gif for animated and png for static emojis", () => {
	assert.equal(
		discordEmojiCdnUrl("1549478493614506104", false),
		"https://cdn.discordapp.com/emojis/1549478493614506104.png"
	);
	assert.equal(
		discordEmojiCdnUrl("1549478493614506104", true),
		"https://cdn.discordapp.com/emojis/1549478493614506104.gif"
	);
});
