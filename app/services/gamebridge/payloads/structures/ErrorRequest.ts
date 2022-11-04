import PayloadRequest from "./PayloadRequest";
export default interface ErrorRequest extends PayloadRequest {
	name: "ErrorRequest";
	data: {
		error: {
			stack: Array<string>;
			realm: string;
			hash: string;
			gamemode: string;
			error: string;
		};
	};
}
