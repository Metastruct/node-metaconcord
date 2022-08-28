<script>
export default {
	head() {
		return {
			script: [
				{
					src: "https://d3js.org/d3.v5.js"
				}
			]
		}
	}
}
</script>

<template>
	<NuxtLayout>
		<NuxtPage />
	</NuxtLayout>
</template>

<style lang="sass">
@import "@/assets/_main.sass"
</style>