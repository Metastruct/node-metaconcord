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
		ingame: boolean;
	};
	msgID: string;
	content: string;
}
