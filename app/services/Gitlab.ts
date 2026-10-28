import { Container, Service } from "../Container.js";
import { Gitlab as Gl } from "@gitbeaker/rest";
import config from "#/config/apikeys.json" with { type: "json" };

export class Gitlab extends Service {
	override name = "Gitlab";

	api = new Gl({ token: config.gitlab });
}

export default function GitlabProvider(container: Container): Service {
	return new Gitlab(container);
}
