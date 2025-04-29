import PayloadRequest from "./PayloadRequest.js";

export default interface NotificationResponse extends PayloadRequest {
	name: "NotificationPayload";
	data: {
		title: string;
		message: string;
		color?: number;
	};
}
