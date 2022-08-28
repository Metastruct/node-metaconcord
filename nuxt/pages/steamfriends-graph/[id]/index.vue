<script setup>
import SteamFriendsGraph from "../../../components/SteamFriendsGraph.vue";
</script>

<template>
	<div class="full-height">
		<ClientOnly>
			<SteamFriendsGraph />
		</ClientOnly>
	</div>
</template>
