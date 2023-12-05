import { Container } from "../Container";
import { HfInference } from "@huggingface/inference";
import { Service } from ".";
import config from "@/config/huggingface.json";

const hf = new HfInference(config.accessToken);

const Model = "mistralai/Mistral-7B-Instruct-v0.1";

export class Huggingface extends Service {
	name = "Huggingface";

	async textGeneration(input: string, limit: number, temperature?: number) {
		return await hf.textGeneration({
			model: Model,
			inputs: `[INST] ${config.systemPrompt} ${input.replaceAll(
				/\[\/?INST\]|<\/?s>/g,
				""
			)} [/INST]`,
			parameters: {
				max_new_tokens: limit,
				temperature: temperature,
				return_full_text: false,
			},
		});
	}

	// async textGenerationStream(input: string, limit?: number) {
	// 	for await (const output of hf.textGenerationStream({
	// 		model: Model,
	// 		inputs: input,
	// 		parameters: { max_new_tokens: limit },
	// 	})) {
	// 		return output.generated_text;
	// 	}
	// }
}
export default (container: Container): Service => {
	return new Huggingface(container);
};
