// Hack: Node typings don't include this yet, but Node actually supports it.
declare global {
	interface Date {
		/**
     * The toTemporalInstant() method of Date instances returns a new Temporal.Instant object
     * with the same epochMilliseconds value as this date's timestamp.
     */
		toTemporalInstant(): Temporal.Instant;
	}
}
