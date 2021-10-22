import PayloadRequest from "./PayloadRequest";

export default interface NotificationResponse extends PayloadRequest {
	name: "NotificationPayload";
	data: {
		message: string;
		color?: number;
	};
}
