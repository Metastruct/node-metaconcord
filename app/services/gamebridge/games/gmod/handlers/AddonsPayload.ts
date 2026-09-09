import { AddonsRequest } from "./structures/index.js";
import GmodConnection from "../GmodConnection.js";
import Payload from "./Payload.js";
import requestSchema from "./structures/AddonsRequest.json" with { type: "json" };

export default class AddonsPayload extends Payload {
	protected static requestSchema = requestSchema;

	static async handle(payload: AddonsRequest, server: GmodConnection): Promise<void> {
		super.handle(payload, server);
		const addons = server.bridge.container.getService("Addons");

		if (payload.data.games) await addons.setGmodGames(server.config.id, payload.data.games);
		if (payload.data.repos) await addons.refreshGmodRepos(server, payload.data.repos);
	}
}
