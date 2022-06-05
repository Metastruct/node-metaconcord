import { PayloadRequest } from "./structures";
import Ajv from "ajv";
import GameServer from "../GameServer";
import util from "util";

export default abstract class Payload {
	protected static requestSchema: Record<any, unknown>;
	protected static responseSchema: Record<any, unknown>;

	protected static isInvalid(
		schema: Record<string, unknown>,
		payload: PayloadRequest | unknown
	): any {
		const ajv = new Ajv();
		const validate = ajv.compile(schema);
		if (!validate(payload)) {
			return validate.errors;
		}
	}

	static validate(schema: Record<string, unknown>, payload: PayloadRequest | unknown): void {
		const invalid = this.isInvalid(schema, payload);
		if (invalid) {
			console.warn(util.inspect(payload, { showHidden: false, depth: null }));
			let msg = "";
			for (let i = 0; i < invalid.length; i++) {
				msg += `${invalid[i].dataPath} ${invalid[i].message}${
					i == invalid.length - 1 ? "" : "\n"
				}`;
			}
			throw new Error(msg);
		}
	}

	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	static async handle(payload: PayloadRequest, server: GameServer): Promise<void> {
		this.validate(this.requestSchema, payload);
	}

	static async send(payload: unknown, server: GameServer): Promise<void> {
		this.validate(this.responseSchema, payload);

		server.connection.send(
			JSON.stringify({
				payload: {
					name: this.name,
					data: payload,
				},
			})
		);
	}
}
