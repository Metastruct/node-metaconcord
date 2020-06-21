import { connection } from "websocket";

declare module "websocket" {
	interface connection {
		sendPayload(name: string, payload): void;
	}
}

connection.prototype.sendPayload = function (name: string, payload): void {
	this.send(
		JSON.stringify({
			payload: {
				name,
				...payload,
			},
		})
	);
};
