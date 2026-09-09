export default interface GservResponse {
	/** The verb, e.g. "qu rehash". The addon's module validates it against its own whitelist. */
	command: string;
	identifier: string;
}
