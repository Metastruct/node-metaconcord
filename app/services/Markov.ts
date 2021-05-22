import { Container } from "@/app/Container";
import { EOL } from "os";
import { Service } from ".";
import Markov from "markov-strings";
import fs from "fs";

const MARKOV_DATA_PATH = "markov_data.txt";

export class MarkovService extends Service {
	name = "Twitter";
	generator = new Markov({ stateSize: 2 });
	genOptions = { maxTries: 20 };

	constructor(container: Container) {
		super(container);
		fs.readFile(MARKOV_DATA_PATH, "utf8", (err, data) => {
			if (err) {
				console.log(err);
				return;
			}

			const lines = data.split(EOL);
			this.generator.addData(lines);
		});
	}

	public addLine(line: string): void {
		const input = [];
		input.push(line);
		this.generator.addData(input);

		fs.appendFile(MARKOV_DATA_PATH, line + EOL, err => {
			if (!err) return;
			console.log(err);
		});
	}

	public generate(): string {
		const res = this.generator.generate(this.genOptions);
		return res.string.trim();
	}
}

export default (container: Container): Service => {
	return new MarkovService(container);
};
