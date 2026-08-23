export type StatsSample = {
	/** unix ms */
	t: number;
	/** % of one core used by the game process */
	cpu: number;
	/** bytes used by the game process */
	memUsed: number;
	/** bytes, the ceiling for memUsed (jvm max heap, host memory, ...) */
	memMax: number;
	/** host bytes/s received */
	netRx: number;
	/** host bytes/s sent */
	netTx: number;
	/** fps (gmod) or tps (minecraft) */
	tick?: number;
	players?: number;
};

/** Fixed-size ring of the latest stats samples, 10 minutes at one sample every 5s. */
export default class StatsHistory {
	static readonly SIZE = 120;
	private samples: StatsSample[] = [];

	push(sample: StatsSample): void {
		this.samples.push(sample);
		if (this.samples.length > StatsHistory.SIZE) {
			this.samples.splice(0, this.samples.length - StatsHistory.SIZE);
		}
	}

	latest(): StatsSample | undefined {
		return this.samples[this.samples.length - 1];
	}

	toArray(): StatsSample[] {
		return this.samples.slice();
	}
}
