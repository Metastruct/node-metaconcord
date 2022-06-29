import PayloadRequest from "./PayloadRequest";

export default interface VoteKickRequest extends PayloadRequest {
	name: "VoteKickPayload";
	data: {
		offender: {
			nick: string;
			steamID: string;
		};
		reporter: {
			nick: string;
			steamID: string;
		};
		reason: string;
		success?: boolean;
	};
}
