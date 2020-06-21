import { connection } from "websocket";

declare module "websocket" {
	interface connection {
		sendPayload(name: string, payload): void;
	}
}
