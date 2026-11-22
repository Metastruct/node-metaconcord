import { createAppAuth, type StrategyOptions } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";

import type { Container } from "../Container.ts";
import { Service } from "../Service.ts";

import config from "#config/github.json" with { type: "json" };

export class Github extends Service {
	override readonly name = "Github";

	octokit = new Octokit({
		authStrategy: createAppAuth,
		auth: {
			appId: config.appId,
			privateKey: config.privateKey,
			installationId: config.installationId,
		} as StrategyOptions,
	});
}

export default function GithubProvider(container: Container) {
	return new Github(container);
}
