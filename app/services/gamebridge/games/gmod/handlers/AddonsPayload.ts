import { AddonsRequest } from "./structures/index.js";
import GmodConnection from "../GmodConnection.js";
import Payload from "./Payload.js";
import requestSchema from "./structures/AddonsRequest.json" with { type: "json" };

export default class AddonsPayload extends Payload {
	protected static requestSchema = requestSchema;

	/**
	 * The game only signals on boot, so a missing list (fresh data dir, new server)
	 * or one built by an older shape would otherwise wait for the next server
	 * reboot. Pull on connect in both cases; every server reconnects on a
	 * metaconcord restart, which is what makes a deploy pick up new fields.
	 */
	static async initialize(server: GmodConnection): Promise<void> {
		if (!server.config.ssh) return;
		const addons = server.bridge.container.getService("Addons");
		if (!addons.needsRefresh("gmod", server.config.id)) return;
		addons.refreshGmodRepos(server).catch(() => {});
	}

	static async handle(payload: AddonsRequest, server: GmodConnection): Promise<void> {
		super.handle(payload, server);
		if (!payload.data.pull || !server.config.ssh) return;

		const addons = server.bridge.container.getService("Addons");
		addons.refreshGmodRepos(server).catch(() => {});
	}
}
