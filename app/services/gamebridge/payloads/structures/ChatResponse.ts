export default interface ChatResponse {
	user: {
		nick: string;
		color: number;
		avatar_url: string;
	};
	replied_message?: {
		user: {
			nick: string;
			color: number;
			avatar_url: string;
		};
		content: string;
	};
	content: string;
	msgID: string;
}
