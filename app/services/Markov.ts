// thank u mr swadical https://github.com/SwadicalRag/node-markov-lite
import { logger } from "@/utils.js";
import { Container, Service } from "../Container.js";
import { Database } from "sqlite";

const log = logger(import.meta);

function levenshtein(a: string, b: string): number {
	const n = a.length;
	const m = b.length;
	if (n === 0) return m;
	if (m === 0) return n;
	const matrix: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
	for (let i = 0; i <= n; i++) matrix[i][0] = i;
	for (let j = 0; j <= m; j++) matrix[0][j] = j;
	for (let i = 1; i <= n; i++) {
		for (let j = 1; j <= m; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			matrix[i][j] = Math.min(
				matrix[i - 1][j] + 1,
				matrix[i][j - 1] + 1,
				matrix[i - 1][j - 1] + cost
			);
		}
	}
	return matrix[n][m];
}

export interface IGenerateOptions {
	depth?: number;
	length?: number;
	continuation?: boolean;
}

abstract class MarkovChainBase {
	abstract learn(data: string): Promise<void>;
	abstract queryDB(chain: string[]): Promise<string | null>;

	private getWords(sentence: string) {
		if (sentence.match(/^\s*$/)) {
			return [];
		}

		return sentence.split(/\s+/g);
	}

	private getCurrentChain(words: string[], depth = 2) {
		const out: string[] = [];

		for (let i = 0; i < depth; i++) {
			if (words[words.length - depth + i]) {
				out.push(words[words.length - depth + i]);
			}
		}

		return out;
	}

	private matchCurrentChain(words: string[], chain: string[], depth = 2) {
		let out: string[] = [];
		const chains: string[][] = [];

		for (let i = 0; i < words.length; i++) {
			const word = words[i].toLocaleLowerCase();

			if (!chain[0] || word == chain[0].toLocaleLowerCase()) {
				let acceptable = true;

				for (let i2 = 0; i2 < chain.length; i2++) {
					if (
						!words[i + i2] ||
						chain[i2].toLocaleLowerCase() != words[i + i2].toLocaleLowerCase()
					) {
						acceptable = false;
						break;
					}
				}

				if (acceptable) {
					if (chain.length < depth) {
						for (let i2 = i; i2 < Math.min(i + depth, words.length); i2++) {
							out.push(words[i2]);
						}
					} else {
						for (let i2 = 1; i2 < chain.length; i2++) {
							out.push(chain[i2]);
						}

						if (words[i + chain.length]) {
							out.push(words[i + chain.length]);
						}
					}

					chains.push(out);
					out = [];
					acceptable = false;
				}
			}
		}

		return chains[Math.round(Math.random() * (chains.length - 1))] || out;
	}

	async generate(
		depth = 4,
		maxLength = 50,
		sentence = "",
		continuation = true,
		callback?: (word: string) => void
	): Promise<string | undefined> {
		let words = this.getWords(sentence);
		let chain = this.getCurrentChain(words, depth);

		const out: string[] = [];

		if (continuation) {
			for (const word of words) {
				out.push(word);
				if (callback) {
					callback(word);
				}
			}
		}

		let lastChain: string[];
		const startCount = out.length;

		while (out.length < maxLength) {
			const data = await this.queryDB(chain);

			if (!data) {
				break;
			}

			words = this.getWords(data);

			lastChain = chain;
			chain = this.matchCurrentChain(words, chain, depth);

			if (chain.length - lastChain.length <= 0 && chain.length < depth) {
				break;
			} else if (lastChain.length < depth) {
				for (let i = lastChain.length; i < chain.length; i++) {
					out.push(chain[i]);
					if (callback) {
						callback(chain[i]);
					}
				}
			} else {
				out.push(chain[chain.length - 1]);
				if (callback) {
					callback(chain[chain.length - 1]);
				}
			}
		}

		return out.length > startCount ? out.join(" ") : undefined;
	}
}

class MarkovChain extends MarkovChainBase {
	private db: Database;

	constructor(db: Database) {
		super();
		this.db = db;
	}

	async ready(): Promise<void> {
		await this.db.run("CREATE TABLE IF NOT EXISTS markov (`message` VARCHAR(255));");
	}

	async learn(data: string): Promise<void> {
		data = data.trim().replace(/\s+/g, " ");
		await this.db.run("INSERT INTO markov VALUES (?)", [data]);
	}

	async sampleWords(limit = 5000): Promise<Map<number, string[]>> {
		const rows = await this.db.all<{ message: string }[]>(
			`SELECT message FROM markov WHERE rowid >= (
       SELECT ABS(RANDOM()) % MAX(rowid) + 1 FROM markov
     ) LIMIT ?`,
			[limit]
		);
		const wordsByLength = new Map<number, string[]>();
		for (const row of rows) {
			for (const w of row.message.toLowerCase().split(/\s+/)) {
				if (w.length < 3) continue;
				const bucket = wordsByLength.get(w.length);
				if (bucket) {
					bucket.push(w);
				} else {
					wordsByLength.set(w.length, [w]);
				}
			}
		}
		return wordsByLength;
	}

	async queryDB(chain: string[]): Promise<string | null> {
		const sentence = chain.join(" ");

		if (sentence.trim() === "") {
			const res = await this.db.get<{ message: string }>(
				"SELECT * FROM markov ORDER BY RANDOM() LIMIT 1"
			);
			return res?.message ?? null;
		}

		const resArr = await this.db.all<{ message: string }[]>(
			"SELECT * FROM markov WHERE (message LIKE ? OR message LIKE ?) ORDER BY RANDOM() LIMIT 1",
			[`_% ${sentence} %_`, `${sentence} %_`]
		);
		for (const res of resArr) {
			if (!res.message.endsWith(sentence)) {
				return res.message;
			}
		}
		return null;
	}
}

export class Markov extends Service {
	name = "Markov";
	private _markov: MarkovChain | null = null;

	private async getMarkov(): Promise<MarkovChain> {
		if (!this._markov) {
			const sql = this.container.getService("SQL");
			const db = sql.getLocalDatabase();
			this._markov = new MarkovChain(db);
			await this._markov.ready();
		}
		return this._markov;
	}

	async learn(data: string): Promise<void> {
		await (await this.getMarkov()).learn(data);
	}

	async generate(sentence?: string, options?: IGenerateOptions): Promise<string | undefined> {
		try {
			return await (
				await this.getMarkov()
			).generate(options?.depth, options?.length, sentence, options?.continuation);
		} catch (err) {
			log.error(err);
			return;
		}
	}

	async exists(word: string | undefined) {
		if (!word || word?.trim() === "") return word;
		const data = await (await this.getMarkov()).queryDB([word]);
		if (data) return word;
	}

	async findClosestWord(word: string, maxDist = 1): Promise<string | null> {
		const lower = word.toLowerCase();
		if (lower.length < 3) return null;

		const wordsByLength = await (await this.getMarkov()).sampleWords();

		if (wordsByLength.has(lower.length)) {
			for (const w of wordsByLength.get(lower.length)!) {
				if (w === lower) return null;
				if (levenshtein(w, lower) <= maxDist) return w;
			}
		}
		// check adjacent lengths (±1) for insertions/deletions
		for (const len of [lower.length - 1, lower.length + 1]) {
			if (len < 3) continue;
			const bucket = wordsByLength.get(len);
			if (!bucket) continue;
			for (const w of bucket) {
				if (levenshtein(w, lower) <= maxDist) return w;
			}
		}
		return null;
	}
}

export default (container: Container): Service => {
	return new Markov(container);
};
