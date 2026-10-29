import { createAppAuth, type StrategyOptions } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";

import { type Container, Service } from "../Container.js";

import config from "#config/github.json" with { type: "json" };

export class Github extends Service {
	override name = "Github";

	octokit = new Octokit({
		authStrategy: createAppAuth,
		auth: {
			appId: config.appId,
			privateKey: config.privateKey,
			installationId: config.installationId,
		} as StrategyOptions,
	});
}

export default function GithubProvider(container: Container): Service {
	return new Github(container);
}
