import * as requestSchema from "./structures/RconRequest.json";
import * as responseSchema from "./structures/RconResponse.json";
import { GameServer } from "..";
import { Payload } from ".";
import RconRequest from "./structures/RconRequest";
import RconResponse from "./structures/RconResponse";

export default class RconPayload extends Payload {
	protected static requestSchema = requestSchema;
	protected static responseSchema = responseSchema;

	private static callbackId = 0;
	private static callbackMap: Map<string, (req: RconRequest) => void> = new Map();

	static async send(payload: RconResponse, server: GameServer): Promise<void> {
		super.send(payload, server);
	}

	static async handle(payload: RconRequest, server: GameServer): Promise<void> {
		super.handle(payload, server);

		const callbackId = payload.data.identifier;
		if (callbackId && this.callbackMap.has(callbackId)) {
			const map = this.callbackMap.get(callbackId);
			if (!map) return;
			const callback: (req: RconRequest) => void = map;
			callback.bind(this)(payload);
		}
	}

	public static async callLua(
		code: string,
		realm: RconResponse["realm"],
		server: GameServer,
		runner: string
	): Promise<RconRequest> {
		const identifier = (this.callbackId++).toString();
		const payload: RconResponse = {
			isLua: true,
			code: code,
			realm: realm,
			command: "",
			runner: runner,
			identifier: identifier.toString(),
		};

		return new Promise(async (resolve, reject) => {
			this.callbackMap.set(identifier, (req: RconRequest) => {
				this.callbackMap.delete(identifier);
				resolve(req);
			});

			setTimeout(() => {
				this.callbackMap.delete(identifier);
				reject("Timeout");
			}, 30000);

			await this.send(payload, server);
		});
	}
}
