import * as path from "path";
import { IService } from "./";
import { promises as fs } from "fs";

export class Data implements IService {
	name = "Data";
	private dataPath = path.join(process.cwd(), "data");

	muted: { [userId: string]: { until: number; reason?: string; muter?: string } } = {};

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
				let data;
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
		for (const [moduleName, data] of Object.entries(this)) {
			if (typeof data !== "object") continue;
			const filePath = path.join(this.dataPath, moduleName + ".json");
			console.log(`Saved ${filePath} with`, data);
			await fs.writeFile(filePath, JSON.stringify(data));
		}
	}
}

export default async (): Promise<IService> => {
	const data = new Data();
	await data.init();
	await data.load();
	return data;
};
