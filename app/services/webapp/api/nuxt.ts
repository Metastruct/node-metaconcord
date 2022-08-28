import { WebApp } from "..";
import { join } from "path";

export default async (webApp: WebApp): Promise<void> => {
	// Check if we need to run Nuxt in development mode
	const isDev = process.env.NODE_ENV !== "production";
	let handler;

	if (isDev) {
		// ! Just fucking use nuxt dev lmao.
		// ? I'll fix this later
		// const { buildNuxt, loadNuxt } = await import("@nuxt/kit");
		// const writeTypes = () => {
		// 	return new Promise(resolve => {
		// 		const prepare = spawn("nuxt", ["prepare"], { shell: true });
		// 		prepare.on("close", resolve);
		// 	});
		// };
		// let currentNuxt;
		// const load = async () => {
		// 	if (currentNuxt) {
		// 		await currentNuxt.close();
		// 	}
		// 	// Get a ready to use Nuxt instance
		// 	currentNuxt = await loadNuxt({ dev: isDev, ready: false });
		// 	await currentNuxt.ready();
		// 	// Enable live build & reloading
		// 	await writeTypes();
		// 	await buildNuxt(currentNuxt);
		// 	handler = currentNuxt.server.app;
		// };
		// const dLoad = debounce(load);
		// // Maybe use chokidar?
		// // https://github.com/nuxt/framework/blob/main/packages/nuxi/src/commands/dev.ts#L115
		// watch(join(process.cwd(), "nuxt"), { recursive: true }, () => {
		// 	if (!currentNuxt) {
		// 		return;
		// 	}
		// 	console.log(currentNuxt.options.vite);
		// 	console.log("Restarting Nuxt...");
		// 	dLoad(true);
		// });
		// await load();
	} else {
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		handler = require(join(process.cwd(), ".output", "server", "node")).handler;
	}

	if (handler) webApp.app.use(handler);
};
