import { AddonsRequest } from "./structures/index.js";
import GmodConnection from "../GmodConnection.js";
import Payload from "./Payload.js";
import requestSchema from "./structures/AddonsRequest.json" with { type: "json" };

export default class AddonsPayload extends Payload {
	protected static requestSchema = requestSchema;

	static async handle(payload: AddonsRequest, server: GmodConnection): Promise<void> {
		super.handle(payload, server);
		if (!payload.data.pull || !server.config.ssh) return;

		const addons = server.bridge.container.getService("Addons");
		addons.refreshGmodRepos(server).catch(() => {});
	}
}
