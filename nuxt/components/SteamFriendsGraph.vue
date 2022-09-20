<script setup lang="ts">
import { PropType, Ref } from "vue";
import { SteamFriend } from "~/types";
import Neo4jD3 from "~/utils/neo4jd3";
import { cloneDeep } from "lodash";

const { user } = defineProps({
	user: {
		type: Object as PropType<SteamFriend>,
	},
});

const d3Data: Ref<{ nodes: any[]; relationships: any[] }> = ref();
const friendsGraphToNodes = (steamId, friends: SteamFriend[], nodes = new Map()) => {
	nodes.set(steamId, {
		labels: ["Persona"],
		properties: {},
		friends,
	});

	if (!friends.length) return nodes;

	for (const friend of friends) {
		nodes.set(friend.steamId, {
			labels: ["Persona"],
			properties: {},
			friends: friend.friends,
		});

		// friendsGraphToNodes(friend.steamId, friend.friends, nodes);
	}

	return nodes;
};
const friendsGraphToRelationships = (steamId, friends: SteamFriend[], relationships = []) => {
	if (!friends.length) return relationships;

	for (const friend of friends) {
		relationships.push({
			id: `${steamId}-${friend.steamId}`,
			type: "friends",
			source: steamId,
			target: friend.steamId,
			startNode: friend.steamId,
			endNode: friend.steamId,
		});

		// friendsGraphToRelationships(friend.steamId, friend.friends, relationships);
	}

	return relationships;
};
const friendsAsD3Data = ({ steamId, friends }) => {
	const data = {
		nodes: Array.from(friendsGraphToNodes(steamId, friends))
			.map(([steamId, node]) => ({
				id: steamId,
				...node,
			}))
			.slice(0, 10),
		relationships: [], // friendsGraphToRelationships(steamId, friends),
	};

	return data;
};

onMounted(() => {
	try {
		d3Data.value = friendsAsD3Data(cloneDeep(user));

		const neo4jd3 = Neo4jD3(".neo4jd3", {
			infoPanel: false,
			neo4jData: { results: [{ data: [{ graph: d3Data.value }] }] },
			onNodeDoubleClick: node => {
				// if (node.labels.includes("Persona")) {
				// 	router.push(`/steamfriends-graph/${node.id}`);
				// }
				const expandedData = friendsAsD3Data({ steamId: node.id, friends: node.friends });

				if (!node.expanded) {
					d3Data.value.nodes = d3Data.value.nodes.concat(expandedData.nodes);
					d3Data.value.relationships = d3Data.value.nodes.concat(expandedData.relationships);
					node.expanded = true;
				} else {
					const newNodes = expandedData.nodes.map(({ id }) => [id, true]);
					const newRelationships = expandedData.relationships.map(({ id }) => [id, true]);
					d3Data.value.nodes.filter(({ id }) => !newNodes[id]);
					d3Data.value.relationships.filter(({ id }) => !newRelationships[id]);
					node.expanded = false;
				}

				neo4jd3.updateWithD3Data(d3Data.value);
			},
		});

		watch(
			user,
			() => {
				try {
					d3Data.value = friendsAsD3Data(cloneDeep(user));
					neo4jd3.updateWithD3Data(d3Data.value);
					console.log(d3Data.value);
				} catch (err) {
					console.warn(err);
				}
				// nodes: [
				// 	{
				// 		id: "1",
				// 		labels: ["Persona"],
				// 		properties: {
				// 			name: "Bell",
				// 		},
				// 	},
				// 	{
				// 		id: "2",
				// 		labels: ["Persona"],
				// 		properties: {
				// 			name: "Lily",
				// 		},
				// 	},
				// ],
				// relationships: [
				// 	{
				// 		id: "1",
				// 		type: "friends",
				// 		source: "1",
				// 		target: "2",
				// 	},
				// ],
			}
			// { immediate: true }
		);
	} catch (err) {
		console.error(err);
	}
});
</script>

<template>
	<div class="neo4jd3" />
</template>

<style lang="sass">
@import "neo4jd3/dist/css/neo4jd3.min.css"

.neo4jd3-info
	display: none
</style>
