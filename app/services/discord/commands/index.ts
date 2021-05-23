import { InteractionResponseFlags } from "slash-create";

export default function EphemeralResponse(content: string) {
	return { content, flags: InteractionResponseFlags.EPHEMERAL };
}
