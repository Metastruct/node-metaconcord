import { logger, sleep } from "@/utils.js";

const log = logger(import.meta);

export type FluxerUser = {
	id: string;
	username: string;
	discriminator: string;
	global_name: string | null;
	avatar: string | null;
	bot?: boolean;
};

export type FluxerAttachment = {
	id: string;
	filename: string;
	description?: string | null;
	content_type?: string | null;
	size: number;
	url?: string | null;
	duration?: number | null;
	waveform?: string | null;
};

export type FluxerMessage = {
	id: string;
	channel_id: string;
	guild_id?: string;
	author: FluxerUser;
	webhook_id?: string | null;
	content: string;
	type: number;
	attachments?: FluxerAttachment[] | null;
	embeds?: unknown[] | null;
	stickers?: { id: string; name: string }[] | null;
	mentions: FluxerUser[];
	mention_roles: string[];
	message_reference?: {
		message_id: string;
		channel_id: string;
		guild_id?: string | null;
		type: number;
	} | null;
	referenced_message?: FluxerMessage | null;
	member?: { nick?: string | null; avatar?: string | null };
	message_snapshots?: FluxerMessageSnapshot[] | null;
	flags?: number;
};

export type FluxerMessageSnapshot = {
	content?: string;
	timestamp?: string;
	edited_timestamp?: string | null;
	mentions?: (string | FluxerUser)[];
	mention_roles?: string[];
	attachments?: FluxerAttachment[];
	embeds?: unknown[] | null;
	stickers?: { id: string; name: string }[];
	type?: number;
};

export type FluxerWebhook = {
	id: string;
	channel_id: string;
	name: string;
	token: string;
	user: FluxerUser;
};

export type BridgeFile = {
	name: string;
	type: string;
	data: Buffer;
	description?: string | null;
	duration?: number;
	waveform?: string;
};

type UploadPlan = {
	id: number;
	filename: string;
	upload_filename: string;
	file_size: number;
	content_type: string;
	upload_mode: "singlepart" | "multipart";
	upload_url?: string;
	upload_id?: string;
	part_size?: number;
	parts?: { part_number: number; upload_url: string }[];
};

export class FluxerApiError extends Error {
	constructor(
		public status: number,
		message: string
	) {
		super(message);
	}
}

export class FluxerRest {
	constructor(
		private readonly apiBaseUrl: string,
		private readonly botToken: string
	) {}

	async request<T>(
		method: string,
		path: string,
		body?: unknown,
		authenticated = true,
		retryUnsafe = false
	): Promise<T> {
		const safePath = path.replace(/(\/webhooks\/\d+\/)[^/?]+/, "$1[token]");
		const canRetryTransientFailure = method !== "POST" || retryUnsafe;
		let transientAttempts = 0;
		let rateLimitAttempts = 0;
		for (;;) {
			try {
				const response = await fetch(`${this.apiBaseUrl}${path}`, {
					method,
					headers: {
						...(authenticated ? { Authorization: `Bot ${this.botToken}` } : {}),
						...(body == null ? {} : { "Content-Type": "application/json" }),
					},
					...(body == null ? {} : { body: JSON.stringify(body) }),
					signal: AbortSignal.timeout(30_000),
				});
				if (response.status === 429 && rateLimitAttempts < 8) {
					rateLimitAttempts++;
					const data = (await response.json().catch(() => null)) as {
						retry_after?: number;
					} | null;
					const retryAfter =
						Number(response.headers.get("Retry-After") ?? data?.retry_after ?? 1) *
						1000;
					await sleep(Math.max(retryAfter, 250));
					continue;
				}
				if (response.status >= 500 && canRetryTransientFailure && transientAttempts < 4) {
					await sleep(500 * 2 ** transientAttempts++);
					continue;
				}
				if (!response.ok) {
					const text = await response.text();
					throw new FluxerApiError(
						response.status,
						`Fluxer ${method} ${safePath}: ${text.slice(0, 1000)}`
					);
				}
				if (response.status === 204) return undefined as T;
				return (await response.json()) as T;
			} catch (error) {
				if (
					error instanceof FluxerApiError ||
					!canRetryTransientFailure ||
					transientAttempts >= 4
				)
					throw error;
				log.warn(
					{ err: error, method, path: safePath, attempt: transientAttempts },
					"Fluxer request failed; retrying"
				);
				await sleep(500 * 2 ** transientAttempts++);
			}
		}
	}

	async uploadAttachments(channelId: string, files: BridgeFile[]) {
		if (files.length === 0) return [];
		const requested = files.slice(0, 10);
		const response = await this.request<{ attachments: UploadPlan[] }>(
			"POST",
			`/channels/${channelId}/attachments`,
			{
				attachments: requested.map((file, id) => ({
					id,
					filename: file.name,
					file_size: file.data.byteLength,
					content_type: file.type,
					...(file.description ? { description: file.description } : {}),
					...(file.duration != null ? { duration: Math.round(file.duration) } : {}),
					...(file.waveform ? { waveform: file.waveform } : {}),
				})),
			}
		);
		const multipart: { upload_filename: string; upload_id: string }[] = [];
		for (const plan of response.attachments) {
			const file = requested[plan.id];
			if (plan.upload_mode === "singlepart") {
				await this.uploadPart(plan.upload_url!, file.data, plan.content_type);
				continue;
			}
			for (const part of plan.parts ?? []) {
				const start = (part.part_number - 1) * plan.part_size!;
				const data = file.data.subarray(
					start,
					Math.min(start + plan.part_size!, file.data.length)
				);
				await this.uploadPart(part.upload_url, data, plan.content_type);
			}
			multipart.push({
				upload_filename: plan.upload_filename,
				upload_id: plan.upload_id!,
			});
		}
		if (multipart.length > 0) {
			await this.request("POST", `/channels/${channelId}/attachments/complete`, {
				uploads: multipart,
			});
		}
		return response.attachments.map(plan => ({
			id: plan.id,
			filename: plan.filename,
			upload_filename: plan.upload_filename,
			file_size: plan.file_size,
			content_type: plan.content_type,
			description: requested[plan.id].description ?? undefined,
			duration: requested[plan.id].duration,
			waveform: requested[plan.id].waveform,
		}));
	}

	private async uploadPart(url: string, data: Buffer, contentType: string) {
		for (let attempt = 0; ; attempt++) {
			try {
				const response = await fetch(url, {
					method: "PUT",
					headers: { "Content-Type": contentType },
					body: data,
					signal: AbortSignal.timeout(120_000),
				});
				if (response.ok) return;
				if (![500, 502, 503].includes(response.status) || attempt >= 3) {
					throw new FluxerApiError(
						response.status,
						`Fluxer attachment upload failed with HTTP ${response.status}`
					);
				}
			} catch (error) {
				if (error instanceof FluxerApiError || attempt >= 3) throw error;
			}
			await sleep(500 * 2 ** attempt);
		}
	}
}
