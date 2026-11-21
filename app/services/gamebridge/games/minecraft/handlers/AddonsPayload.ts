import type MinecraftConnection from "../MinecraftConnection.ts";
import Payload from "./Payload.ts";
import requestSchema from "./structures/AddonsRequest.json" with { type: "json" };
import type { AddonsRequest } from "./structures/index.ts";

export default class AddonsPayload extends Payload {
	protected static override requestSchema = requestSchema;

	static override async handle(payload: AddonsRequest, server: MinecraftConnection): Promise<void> {
		super.handle(payload, server);
		const addons = server.bridge.container.getService("Addons");
		await addons.setModList(server, payload.data.mods);
	}
}
