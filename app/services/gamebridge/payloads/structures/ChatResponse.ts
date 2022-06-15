export default interface ChatResponse {
	user: {
		id: string;
		nick: string;
		color: number;
		avatar_url: string;
	};
	replied_message?: {
		msgID: string;
		content: string;
		ingameName: string;
	};
	msgID: string;
	content: string;
}
