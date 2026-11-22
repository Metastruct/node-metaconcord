import { Gitlab as Gl } from "@gitbeaker/rest";

import type { Container } from "../Container.ts";
import { Service } from "../Service.ts";

import config from "#config/apikeys.json" with { type: "json" };

export class Gitlab extends Service {
	override readonly name = "Gitlab";

	api = new Gl({ token: config.gitlab });
}

export default function GitlabProvider(container: Container) {
	return new Gitlab(container);
}
