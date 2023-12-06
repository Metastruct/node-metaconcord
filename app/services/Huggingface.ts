import { Container } from "../Container";
import { HfInference } from "@huggingface/inference";
import { Service } from ".";
import config from "@/config/huggingface.json";

export class Huggingface extends Service {
	name = "Huggingface";
	inference = new HfInference(config.accessToken);
}
export default (container: Container): Service => {
	return new Huggingface(container);
};
