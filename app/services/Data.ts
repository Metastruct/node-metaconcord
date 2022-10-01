import { Container } from "@/app/Container";
import { Service } from ".";
import { promises as fs } from "fs";
import path from "path";

export class Data extends Service {
	name = "Data";
	private dataPath = path.join(process.cwd(), "data");

	muted: {
		[userId: string]: {
			until?: number;
			at?: number;
			reason?: string;
			muter?: string;
		};
	} = {};
	nextMkTime: number;
	timesReported: {
		[steamId64: string]: number;
	} = {};
	timesVoteKicked: {
		[steamId64: string]: number;
	} = {};
	lastDiscordGuildIcon: "None";
	lastIotdAuthors: Array<string>;
	toSave = [
		"muted",
		"nextMkTime",
		"timesReported",
		"timesVoteKicked",
		"lastDiscordGuildIcon",
		"lastIotdAuthors",
	];

	async init(): Promise<void> {
		try {
			if (!(await fs.stat(this.dataPath)).isDirectory()) {
				await fs.unlink(this.dataPath);
				throw new Error("Data path was not a directory");
			}
		} catch (err) {
			await fs.mkdir(this.dataPath);
		}
	}

	async load(): Promise<void> {
		for (const file of await fs.readdir(this.dataPath)) {
			const filePath = path.join(this.dataPath, file);
			if ((await fs.stat(filePath)).isFile() && path.extname(filePath) == ".json") {
				let data: unknown;
				try {
					data = JSON.parse(await fs.readFile(filePath, "utf8"));
				} catch (err) {
					data = {};
				}
				console.log(`Loaded ${filePath} with`, data);
				this[path.basename(filePath, ".json")] = data;
			}
		}
	}

	async save(): Promise<void> {
		for (const moduleName of this.toSave) {
			const data = this[moduleName];
			// if (typeof data !== "object") continue;
			const filePath = path.join(this.dataPath, moduleName + ".json");
			// console.log(`Saved ${filePath} with`, data);
			await fs.writeFile(filePath, JSON.stringify(data ?? {}));
		}
	}
}

export default async (container: Container): Promise<Service> => {
	const data = new Data(container);
	await data.init();
	await data.load();
	return data;
};
