import { connection } from "websocket";

declare module "websocket" {
	interface connection {
		sendError(error: any): void;
	}
}

connection.prototype.sendError = function (error: any): void {
	this.send(
		JSON.stringify({
			payload: {
				name: "ErrorPayload",
				error,
			},
		})
	);
};
