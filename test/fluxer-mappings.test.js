import assert from "node:assert/strict";
import test from "node:test";
import mappings from "../app/services/fluxer/mappings.json" with { type: "json" };

const CHANNEL_KINDS = new Set([
	"category",
	"text",
	"voice",
	"forum",
	"thread",
	"forum_post",
	"archived_thread",
	"forum_placeholder",
]);
const RELAYABLE_CHANNEL_KINDS = new Set(["text", "forum", "thread", "forum_post"]);
const THREAD_KINDS = new Set(["thread", "forum_post"]);

test("Fluxer mappings are unique in both directions", () => {
	assert.equal(
		new Set(mappings.channels.map(route => route.discordChannelId)).size,
		mappings.channels.length
	);
	assert.equal(
		new Set(mappings.channels.map(route => route.fluxerChannelId)).size,
		mappings.channels.length
	);
	assert.equal(
		new Set(mappings.roles.map(role => role.discordRoleId)).size,
		mappings.roles.length
	);
	assert.equal(
		new Set(mappings.roles.map(role => role.fluxerRoleId)).size,
		mappings.roles.length
	);
	const threads = mappings.threads ?? [];
	assert.equal(new Set(threads.map(thread => thread.discordThreadId)).size, threads.length);
	assert.equal(new Set(threads.map(thread => thread.fluxerThreadId)).size, threads.length);
});

test("channel and thread route kinds are known", () => {
	for (const route of mappings.channels) {
		assert.ok(
			CHANNEL_KINDS.has(route.channelKind),
			`unknown channel kind ${route.channelKind}`
		);
		if (route.relayEnabled) {
			assert.ok(
				RELAYABLE_CHANNEL_KINDS.has(route.channelKind),
				`unexpected relay for kind ${route.channelKind}`
			);
		} else {
			assert.ok(
				!RELAYABLE_CHANNEL_KINDS.has(route.channelKind),
				`disabled relay route has a relayable kind ${route.channelKind}`
			);
		}
	}
	for (const thread of mappings.threads ?? []) {
		assert.ok(
			THREAD_KINDS.has(thread.channelKind),
			`unknown thread kind ${thread.channelKind}`
		);
		assert.equal(thread.relayEnabled, true);
	}
});

test("permanent-message backfill routes are embedded and writable", () => {
	assert.equal(mappings.permanentMessageChannelIds.length, 2);
	for (const channelId of mappings.permanentMessageChannelIds) {
		const route = mappings.channels.find(item => item.discordChannelId === channelId);
		assert.ok(route?.relayEnabled, `missing writable route for ${channelId}`);
	}
});
