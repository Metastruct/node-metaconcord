import { RconRequest, RconResponse } from "./structures/index.js";
import GmodConnection from "@/app/services/gamebridge/games/gmod/GmodConnection.js";
import Payload from "./Payload.js";
import requestSchema from "./structures/RconRequest.json" with { type: "json" };
import responseSchema from "./structures/RconResponse.json" with { type: "json" };

export default class RconPayload extends Payload {
	protected static requestSchema = requestSchema;
	protected static responseSchema = responseSchema;

	private static callbackId = 0;
	private static callbackMap: Map<string, (req: RconRequest) => void> = new Map();

	static async send(payload: RconResponse, server: GmodConnection): Promise<void> {
		super.send(payload, server);
	}

	static async handle(payload: RconRequest, server: GmodConnection): Promise<void> {
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
		server: GmodConnection,
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

		const resultPromise = new Promise<RconRequest>((resolve, reject) => {
			this.callbackMap.set(identifier, (req: RconRequest) => {
				this.callbackMap.delete(identifier);
				resolve(req);
			});

			setTimeout(() => {
				this.callbackMap.delete(identifier);
				reject("Timeout");
			}, 30000);
		});

		await this.send(payload, server);

		return resultPromise;
	}
}
