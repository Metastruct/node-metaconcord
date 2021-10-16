export default interface ChatResponse {
	user: {
		nick: string;
		color: number;
	};
	replied_message?: {
		nick: string;
		color: number;
		content: string;
	};
	content: string;
}
