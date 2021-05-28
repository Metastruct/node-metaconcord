import { MessageOptions } from "slash-create";

export default function EphemeralResponse(content: string): MessageOptions {
	return { content, ephemeral: true };
}
