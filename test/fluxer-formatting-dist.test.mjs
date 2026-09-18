import assert from "node:assert/strict";
import test from "node:test";
import {
	componentEmbeds,
	componentFallbackText,
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
