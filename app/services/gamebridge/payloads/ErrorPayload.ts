import * as responseSchema from "./structures/ErrorResponse.json";
import Payload from "./Payload";

export default class ErrorPayload extends Payload {
	protected static responseSchema = responseSchema;
}
