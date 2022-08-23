import { WebApp } from "..";

export default async (webApp: WebApp): Promise<void> => {
	const { buildNuxt, loadNuxt } = await import("@nuxt/kit");

	// TODO: Find a way to live build but disallow reloading?
	// Maybe you have to build before?

	// Check if we need to run Nuxt in development mode
	const isDev = true; // process.env.NODE_ENV !== "production";

	// Get a ready to use Nuxt instance
	const nuxt = await loadNuxt({ dev: isDev, ready: false });
	await nuxt.ready();

	// Enable live build & reloading
	if (isDev) {
		buildNuxt(nuxt);
	}

	// Probably need to do more stuff here, look at nuxi dev / nuxi build

	webApp.app.use(nuxt.server.app);
};
