import PayloadRequest from "./PayloadRequest.js";
/** gmod cannot enumerate its own addons, so it only signals that it is ready to be pulled over SSH. */
export default interface AddonsRequest extends PayloadRequest {
	name: "AddonsPayload";
	data: {
		pull: boolean;
		/** Game content the server has mounted, reported on every connect. */
		games?: {
			folder: string;
			/** Absent when the engine has no name for it; the folder is the fallback. */
			title?: string;
		}[];
	};
}
