import { Container } from "@/app/Container";
import { EOL } from "os";
import { Service } from ".";
import Markov from "markov-strings";
import fs from "fs";

const MARKOV_DATA_PATH = "markov_data.txt";
const MIGRATION_RATE = 50;

export class MarkovService extends Service {
	name = "Markov";
	generator = new Markov({ stateSize: 2 });
	genOptions = { maxTries: 20 };

	constructor(container: Container) {
		super(container);

		setTimeout(async () => {
			const sql = this.container.getService("Sql");
			const db = await sql.getDatabase();
			const hasTable = await sql.tableExists("markov");
			if (!hasTable) {
				await db.exec(`CREATE TABLE markov (Data TEXT);`);
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

			const res = await db.all("SELECT * FROM markov;");
			if (res.length > 0) {
				this.generator.addData(res.map(row => row.Data));
			}
		}, 5000); // call after everything has initialized ?
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
		await db.run("INSERT INTO markov (Data) VALUES(?)", line);
	}

	public generate(): string {
		const res = this.generator.generate(this.genOptions);
		return res.string.trim();
	}
}

export default (container: Container): Service => {
	return new MarkovService(container);
};
