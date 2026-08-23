export default interface ConsoleResponse {
	action: "subscribe" | "unsubscribe" | "command";
	command?: string;
}
