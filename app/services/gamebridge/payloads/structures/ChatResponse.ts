export default interface ChatResponse {
	user: {
		avatar_url: string;
		color: number;
		id: string;
		nick: string;
		username: string;
	};
	replied_message?: {
		content: string;
		ingameName: string;
		msgID: string;
	};
	content: string;
	msgID: string;
}
