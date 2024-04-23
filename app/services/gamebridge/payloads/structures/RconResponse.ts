export default interface RconResponse {
	isLua: boolean;
	code: string;
	command: string;
	realm: "sh" | "sv" | "cl";
	runner: string;
	identifier: string;
}
