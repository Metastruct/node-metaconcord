<script setup>
import Neo4jD3 from "neo4jd3/dist/js/neo4jd3.min.js";

onMounted(() => {
	try {
		const neo4jd3 = new Neo4jD3(".neo4jd3", {
			infoPanel: false,
			neo4jData: { results: [{ data: [] }] },
		});

		neo4jd3.updateWithD3Data({
			nodes: [
				{
					id: "1",
					labels: ["Persona"],
					properties: {
						name: "Bell",
					},
				},
				{
					id: "2",
					labels: ["Persona"],
					properties: {
						name: "Lily",
					},
				},
			],
			relationships: [
				{
					id: "1",
					type: "friends",
					source: "1",
					target: "2"
				},
			],
		});
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
