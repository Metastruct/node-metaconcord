import PayloadRequest from "./PayloadRequest.js";
export default interface DeathRequest extends PayloadRequest {
	name: "DeathPayload";
	data: {
		player: {
			nick: string;
			uuid: string;
		};
		/**
		 * the vanilla death message, e.g. "Nick was slain by Zombie"
		 * @maxLength 256
		 */
		message: string;
	};
}
