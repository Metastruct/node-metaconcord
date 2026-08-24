export default interface ConsoleResponse {
	action: "subscribe" | "unsubscribe" | "command";
	command?: string;
	/** who ran the command, printed in the server log for traceability */
	runner?: string;
}
