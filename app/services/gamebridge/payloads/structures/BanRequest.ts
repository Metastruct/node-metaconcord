import PayloadRequest from "./PayloadRequest";
export default interface BanRequest extends PayloadRequest {
	name: "BanPayload";
	ban: {
		banned: string;
		banner: string;
		reason: string;
		unbanTime: string;
	};
}
