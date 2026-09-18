import assert from "node:assert/strict";
import test from "node:test";
import mappings from "../app/services/fluxer/mappings.json" with { type: "json" };

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
});

test("only writable text and active thread routes relay", () => {
	const enabled = mappings.channels.filter(route => route.relayEnabled);
	assert.equal(enabled.length, 44);
	assert.ok(
		enabled.every(route => route.channelKind === "text" || route.channelKind === "thread")
	);
	assert.equal(enabled.filter(route => route.channelKind === "thread").length, 3);
	assert.ok(
		mappings.channels
			.filter(route =>
				["category", "voice", "forum_placeholder", "archived_thread"].includes(
					route.channelKind
				)
			)
			.every(route => !route.relayEnabled)
	);
});

test("permanent-message backfill routes are embedded and writable", () => {
	assert.equal(mappings.permanentMessageChannelIds.length, 2);
	for (const channelId of mappings.permanentMessageChannelIds) {
		const route = mappings.channels.find(item => item.discordChannelId === channelId);
		assert.ok(route?.relayEnabled, `missing writable route for ${channelId}`);
	}
});
