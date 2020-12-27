import { DiscordClient, GameBridge } from "./index";
import { ErrorPayload } from "./payloads";
import { ErrorResponse } from "./payloads/structures";
import { connection as WebSocketConnection, request as WebSocketRequest } from "websocket";

export type GameServerConfig = {
	id: number;
	ip: string;
	name: string;
	label?: string;
	discordToken: string;
};

export default class GameServer {
	connection: WebSocketConnection;
	config: GameServerConfig;
	bridge: GameBridge;
	discord: DiscordClient;
	status: {
		players: {
			accountId?: number;
			nick: string;
			avatar?: string;
			isAdmin?: boolean;
		}[];
	} = { players: [] };
	playerListImage: Buffer;

	constructor(req: WebSocketRequest, bridge: GameBridge, config: GameServerConfig) {
		this.connection = req.accept();
		this.config = config;
		this.bridge = bridge;
		this.discord = new DiscordClient(this);

		this.discord.run();

		this.connection.on("message", async ({ utf8Data }) => {
			// if (received.utf8Data == "") console.log("Heartbeat");
			if (!utf8Data || utf8Data == "") return;

			let data: { payload: any };
			try {
				data = JSON.parse(utf8Data);
			} catch (e) {
				return new ErrorPayload(this).send({
					error: { message: "Malformed JSON" },
				} as ErrorResponse);
			}

			let payloadRequest: { name: string };
			try {
				payloadRequest = data.payload;
			} catch (err) {
				return new ErrorPayload(this).send({
					error: { message: "Missing payload" },
				} as ErrorResponse);
			}

			try {
				for (const [name, type] of Object.entries(bridge.payloads)) {
					if (payloadRequest.name === name) {
						const payload = new type(this);
						return payload.handle(req, payloadRequest);
					}
				}
			} catch (err) {
				console.log(payloadRequest);
				console.error(`${data.payload.name} exception:`, err);
				return;
			}

			console.log("Invalid payload:");
			console.log(payloadRequest?.name, payloadRequest);
			new ErrorPayload(this).send({
				error: { message: "Payload doesn't exist, nothing to do" },
			} as ErrorResponse);
		});

		this.connection.on("close", (code, desc) => {
			this.discord.kill();
			console.log(`'${this.config.name}' Game Server disconnected - [${code}] ${desc}`);
		});

		console.log(`'${this.config.name}' Game Server connected`);
	}
}
