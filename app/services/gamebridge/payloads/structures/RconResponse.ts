export default interface RconResponse {
	isLua: boolean;
	code: string;
	command: string;
	realm: string;
	runner: string;
}
