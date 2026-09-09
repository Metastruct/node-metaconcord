import PayloadRequest from "./PayloadRequest.js";
/** One line of gserv output, or the run finishing. */
export default interface GservRequest extends PayloadRequest {
	name: "GservPayload";
	data: {
		/** Echoes the identifier the run was started with. */
		identifier: string;
		/** Which stream the line came from; absent on the final message. */
		kind?: "stdout" | "stderr";
		/** The line, without its newline. */
		data?: string;
		/** Present once, last. */
		done?: boolean;
		/** gserv's exit code, absent when it never ran. */
		code?: number;
		/** Set instead of a code when the verb was refused or gserv could not start. */
		error?: string;
	};
}
