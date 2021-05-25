import { InteractionResponseFlags } from "slash-create";

export default function EphemeralResponse(content: string): {
	content: string;
	flags: InteractionResponseFlags;
} {
	return { content, flags: InteractionResponseFlags.EPHEMERAL };
}
