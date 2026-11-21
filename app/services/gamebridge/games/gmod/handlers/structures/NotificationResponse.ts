import type PayloadRequest from "./PayloadRequest.ts";

export default interface NotificationResponse extends PayloadRequest {
	name: "NotificationPayload";
	data: {
		title: string;
		message: string;
		color?: number;
	};
}
