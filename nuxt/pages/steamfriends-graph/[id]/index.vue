<script setup lang="ts">
import SteamFriendsGraph from "~/components/SteamFriendsGraph.vue";
import { SteamFriend } from "~/types"
import axios from "axios";
import { Ref } from "vue";

const route = useRoute();
const steamId = route.params.id as string;
const error = ref(false);
if (!/^\d+$/.test(steamId)) {
	error.value = true;
	console.error("Invalid SteamID")
}

const user: Ref<SteamFriend> = ref();
const isDev = process.env.NODE_ENV !== "production";
const BASE_URL = isDev ? "http://localhost:20122" : "";
try {
	const res = await axios.get(`${BASE_URL}/steamfriends-graph/api/${route.params.id}`);
	user.value = res.data;
} catch (err) {
	error.value = true;
	console.error(err)
}
</script>

<template>
	<div v-if="error">Something went wrong</div>
	<div v-else class="full-height">
		<ClientOnly>
			<SteamFriendsGraph :user="user" />
		</ClientOnly>
	</div>
</template>
