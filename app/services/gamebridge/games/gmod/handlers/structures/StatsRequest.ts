import PayloadRequest from "./PayloadRequest.js";
export default interface StatsRequest extends PayloadRequest {
	name: "StatsPayload";
	data: {
		/** % of one core used by the srcds process */
		cpu: number;
		/** resident bytes of the srcds process */
		memUsed: number;
		/** host memory, the ceiling for memUsed */
		memMax: number;
		/** host bytes/s received */
		netRx: number;
		/** host bytes/s sent */
		netTx: number;
		fps: number;
		players: number;
		maxPlayers: number;
	};
}
