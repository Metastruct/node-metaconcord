import * as responseSchema from "./structures/RconResponse.json";
import { GameServer } from "..";
import { Payload } from ".";
import RconResponse from "./structures/RconResponse";

export default class RconPayload extends Payload {
	protected static responseSchema = responseSchema;

	static async send(payload: RconResponse, server: GameServer): Promise<void> {
		super.send(payload, server);
	}
}
