import PayloadRequest from "./PayloadRequest";

export default interface AdminNotifyRequest extends PayloadRequest {
	name: "AdminNotifyPayload";
	nick: string;
	steamId: string;
	reportedNick: string;
	reportedSteamId: string;
	message: string;
}
