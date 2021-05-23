import { Container } from "@/app/Container";
import { SlashCommand, SlashCreator } from "slash-create";

export class SlashMarkovCommand extends SlashCommand {
	private container: Container;

	constructor(container: Container, creator: SlashCreator) {
		super(creator, {
			name: "mk",
			description: "Funny text generation based off the gmod and discord chats.",
		});
		this.filePath = __filename;
		this.container = container;
	}

	async run(): Promise<string> {
		return this.container.getService("Markov").generate();
	}
}
