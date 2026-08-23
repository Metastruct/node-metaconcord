import PayloadRequest from "./PayloadRequest.js";
export default interface StatsRequest extends PayloadRequest {
	name: "StatsPayload";
	data: {
		/** % of one core used by the server process */
		cpu: number;
		/** jvm heap bytes in use */
		memUsed: number;
		/** jvm max heap bytes */
		memMax: number;
		/** host bytes/s received */
		netRx: number;
		/** host bytes/s sent */
		netTx: number;
		tps: number;
		/** average ms per tick */
		mspt: number;
		players: number;
	};
}
