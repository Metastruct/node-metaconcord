import { Container, Service } from "../Container.js";
import { Octokit } from "@octokit/rest";
import { createAppAuth } from "@octokit/auth-app";
import config from "@/config/github.json" with { type: "json" };

export class Github extends Service {
	name = "Github";

	octokit = new Octokit({
		authStrategy: createAppAuth,
		auth: {
			appId: config.appId,
			privateKey: config.privateKey,
			installationId: config.installationId,
		},
	});
}

export default (container: Container): Service => {
	return new Github(container);
};
