import PayloadRequest from "./PayloadRequest.js";
/** gmod cannot enumerate its own addons, so the native module reads ~/gserv/repos and reports it here on every connect. */
export default interface AddonsRequest extends PayloadRequest {
	name: "AddonsPayload";
	data: {
		/** One row per addon root. Absent when the server has no native module. */
		repos?: {
			/** directory name under ~/gserv/repos */
			repo: string;
			/** addon root inside the repo, "." when the repo itself is the addon */
			sub: string;
			/** origin remote url, empty when there is none */
			remote: string;
			/** workshop id from .workshopid, empty when there is none */
			wsid: string;
			/** branch name, or a short sha when HEAD is detached */
			branch: string;
		}[];
		/** Game content the server has mounted, reported on every connect. */
		games?: {
			folder: string;
			/** Absent when the engine has no name for it; the folder is the fallback. */
			title?: string;
			/** The steam app id. */
			depot?: number;
		}[];
	};
}
