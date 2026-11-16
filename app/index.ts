import { type Container } from "./Container.ts";

declare global {
	var MetaConcord: {
		container: Container;
	};
}

export { App } from "./App.ts";
