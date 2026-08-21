import { AddonsRequest } from "./structures/index.js";
import MinecraftConnection from "../MinecraftConnection.js";
import Payload from "./Payload.js";
import requestSchema from "./structures/AddonsRequest.json" with { type: "json" };

export default class AddonsPayload extends Payload {
	protected static requestSchema = requestSchema;

	static async handle(payload: AddonsRequest, server: MinecraftConnection): Promise<void> {
		super.handle(payload, server);
		const addons = server.bridge.container.getService("Addons");
		await addons.setModList(server, payload.data.mods);
	}
}
