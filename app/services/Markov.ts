import { Container } from "@/app/Container";
//import { EOL } from "os";
import { Service } from ".";
import Markov from "markov-strings";
import sleep from "sleep-promise";
//import fs from "fs";

//const MARKOV_DATA_PATH = "markov_data.txt";
//const MIGRATION_RATE = 50;

export class MarkovService extends Service {
	name = "Markov";
	generator = new Markov({ stateSize: 2 });
	genOptions = { maxTries: 20 };

	building: boolean;
	constructor(container: Container) {
		super(container);
		this.building = true;

		(async () => {
			const sql = this.container.getService("Sql");
			const db = await sql.getDatabase();
			const hasTable = await sql.tableExists("markov");
			if (!hasTable) {
				await db.exec(`CREATE TABLE markov (string TEXT);`);
			}

			// legacy data
			/*if (fs.existsSync(MARKOV_DATA_PATH)) {
				fs.readFile(MARKOV_DATA_PATH, "utf8", async (err, data) => {
					if (err) {
						console.log(err);
						return;
					}

					const lines = data.split(EOL);
					let promises = [];
					let current = 0;
					for (const line of lines) {
						promises.push(db.run("INSERT INTO markov (Data) VALUES (?)", line));

						if (promises.length % MIGRATION_RATE === 0) {
							await Promise.all(promises);
							promises = [];
							current += MIGRATION_RATE;
							console.log(`Processed ${current} / ${lines.length}`);
						}
					}

					this.generator.addData(lines);
					//fs.unlinkSync(MARKOV_DATA_PATH);
				});
			}*/

			// load our data asynchronously so we don't hog the resources for the rest
			const res = await db.all("SELECT string FROM markov;");
			if (res.length > 0) {
				const old = Date.now();
				console.log("Building markov...");

				let dataChunk = [];
				for (let i = 0; i < res.length; i++) {
					dataChunk.push(res[i]);

					if (i % 500 === 0) {
						this.generator.addData(dataChunk);
						dataChunk = [];

						await sleep(100);
					}
				}

				this.generator.addData(dataChunk);
				this.building = false;
				console.log(`Done (in ${(Date.now() - old) / 1000}s)`);
			}
		})();
	}

	private sanitizeString(input: string): string {
		if (!input) return "";

		return input
			.replace(/\(|\)|\[|\]|\@|\<|\>|\"|\{|\}|\\|\,|\.|\;/g, "")
			.replace(/-|\t|_|\n/g, " ")
			.replace(/\s{2,}/g, " ")
			.trim();
	}

	public async addLine(line: string): Promise<void> {
		line = this.sanitizeString(line);
		if (line.length <= 0) return;

		this.generator.addData([line]);

		const sql = this.container.getService("Sql");
		const db = await sql.getDatabase();
		await db.run("INSERT INTO markov (string) VALUES(?)", line);
	}

	public generate(): string {
		if (this.generator.data.length === 0) {
			return "Service is still loading";
		}

		const res = this.generator.generate(this.genOptions);
		return res.string.trim();
	}
}

export default (container: Container): Service => {
	return new MarkovService(container);
};
