/** Minimal in-memory TTL cache; callers decide what to do on miss. */
export class TTLCache<V> {
	private entries = new Map<string, { value: V; expires: number }>();
	private ttlMs: number;

	constructor(ttlMs: number) {
		this.ttlMs = ttlMs;
	}

	get(key: string): V | undefined {
		const entry = this.entries.get(key);
		if (!entry) return;
		if (entry.expires < Date.now()) {
			this.entries.delete(key);
			return;
		}
		return entry.value;
	}

	set(key: string, value: V): V {
		this.entries.set(key, { value, expires: Date.now() + this.ttlMs });
		return value;
	}

	has(key: string): boolean {
		return this.get(key) !== undefined;
	}
}
