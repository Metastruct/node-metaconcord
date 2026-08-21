import PayloadRequest from "./PayloadRequest.js";
export default interface AddonsRequest extends PayloadRequest {
	name: "AddonsPayload";
	data: {
		mods: {
			modId: string;
			displayName: string;
			version: string;
			description?: string;
			/** hex sha512 of the jar, for Modrinth */
			sha512?: string;
			/** murmur2 of the jar with whitespace stripped, for CurseForge */
			fingerprint?: number;
			sources?: string;
			issues?: string;
		}[];
	};
}
