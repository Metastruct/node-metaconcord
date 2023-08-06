import { WebApp } from "..";
import { Webhooks, createNodeMiddleware } from "@octokit/webhooks";
import { clamp } from "@/utils";
import Discord from "discord.js";
import axios from "axios";
import webhookConfig from "@/config/webhooks.json";

const COLOR_MOD = 75;
const COLOR_BASE = 50;

const GitHub = new Webhooks({
	secret: webhookConfig.github.secret,
});

// todo: maybe there is a better way for this?
const PublicCommits = new Discord.WebhookClient({
	url: webhookConfig.webhookUrls.public.commits,
});
const PrivateCommits = new Discord.WebhookClient({
	url: webhookConfig.webhookUrls.private.commits,
});
const MappingCommits = new Discord.WebhookClient({
	url: webhookConfig.webhookUrls.public.mapping,
});
const TestCommits = new Discord.WebhookClient({
	url: webhookConfig.webhookUrls.private.test,
});

const BaseEmbed = {
	allowedMentions: { parse: ["users"] },
} as Discord.WebhookMessageCreateOptions;

const GetGithubChanges = (
	added: string[],
	removed: string[],
	modified: string[],
	host: "GitHub" | "GitLab",
	repoPath: string,
	sha: string
): string[] => {
	// behold, the most cursed thing known to mankind
	return [].concat.apply(
		[],
		[
			added.map(
				s =>
					`Add [${s}](https://${
						host === "GitHub" ? "github.com" : "gitlab.com"
					}/${repoPath}/blob/${sha}/${s.replace(" ", "%%20")})`
			),
			removed.map(
				s =>
					`Del [${s}](https://${
						host === "GitHub" ? "github.com" : "gitlab.com"
					}/${repoPath}/blob/${sha}/${s.replace(" ", "%%20")})`
			),
			modified.map(
				s =>
					`Mod [${s}](https://${
						host === "GitHub" ? "github.com" : "gitlab.com"
					}/${repoPath}/blob/${sha}/${s.replace(" ", "%%20")})`
			),
		]
	);
};

const getGitHubDiff = async (url: string) => {
	const res = await axios.get<string>(url + ".diff");
	if (res) return res.data;
};

GitHub.on("push", async event => {
	const embeds: Discord.APIEmbed[] = [];
	const fields: Discord.APIEmbedField[] = [];
	const commits = event.payload.commits;
	for (const commit of commits) {
		const changes = GetGithubChanges(
			commit.added,
			commit.removed,
			commit.modified,
			"GitHub",
			event.payload.repository.full_name,
			event.payload.ref
		);

		for (let i = 0; i < changes.length; i++) {
			const change = changes[i];
			fields.push({
				name: i > 0 ? "​" : "---",
				value: change.length > 1024 ? "<LINK TOO LONG>" : change,
			});
		}

		let diff = await getGitHubDiff(commit.url);
		if (diff) {
			diff = diff.replace(/(@@ -\d+,\d+ .+\d+,\d+ @@)[^\n]/g, "$1\n");
			diff = diff.replace(/diff.+\nindex.+\n/g, "");
			diff = diff.replace("```", "\\`\\`\\`");
		}

		embeds.push({
			title:
				commit.message.length > 256
					? `${commit.message.substring(0, 250)}. . .`
					: commit.message,
			description: diff
				? `\`\`\`diff\n${
						diff.length > 4096 - 12 ? diff.substring(0, 4079) + ". . ." : diff
				  }\`\`\``
				: undefined,

			color:
				clamp(COLOR_BASE + COLOR_MOD * commit.removed.length, COLOR_BASE, 255) * 65536 +
				clamp(COLOR_BASE + COLOR_MOD * commit.added.length, COLOR_BASE, 255) * 256 +
				clamp(COLOR_BASE + COLOR_MOD * commit.modified.length, COLOR_BASE, 255),
			url: commit.url,
			fields: fields,
			timestamp: commit.timestamp,
			footer: {
				text: `${commit.id.substring(0, 6)} by ${
					commit.author.username ?? commit.author.name
				}${
					commit.author.name !== commit.committer.name
						? ` via ${commit.committer.username ?? commit.committer.name}`
						: ""
				}`,
			},
		});
	}
	const payload = {
		...BaseEmbed,
		username: event.payload.sender.name ?? event.payload.sender.login,
		avatarURL: event.payload.sender.avatar_url,
		content: event.payload.forced
			? "<a:ALERTA:843518761160015933> Force Pushed <a:ALERTA:843518761160015933>"
			: "",
		embeds: embeds,
	};
	if (embeds.length > 10) {
		for (let i = 0; i < embeds.length; i += 10) {
			const chunk = embeds.slice(i, i + 10);
			PublicCommits.send({ ...payload, embeds: chunk });
		}
	} else {
		PublicCommits.send(payload);
	}
});

export default (webApp: WebApp): void => {
	webApp.app.post("/webhooks/gitlab", async (req, res) => {
		return res.status(500); // todo
	});
	webApp.app.use(createNodeMiddleware(GitHub, { path: "/webhooks/github" }));
};
