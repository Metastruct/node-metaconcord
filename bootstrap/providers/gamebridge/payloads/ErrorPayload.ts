import * as responseSchema from "./structures/ErrorResponse.json";
import { ErrorResponse } from "./structures";
import Payload from "./Payload";

export default class ErrorPayload extends Payload {
	protected responseSchema = responseSchema;

	async send(payload: ErrorResponse): Promise<void> {
		super.send(payload);
	}
}
