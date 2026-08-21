import PayloadRequest from "./PayloadRequest.js";
/** gmod cannot enumerate its own addons, so it only signals that it is ready to be pulled over SSH. */
export default interface AddonsRequest extends PayloadRequest {
	name: "AddonsPayload";
	data: {
		pull: boolean;
	};
}
