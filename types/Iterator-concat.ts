// Introduced with ES2026, which is not supported by Typescript 6.
// TODO [typescript@>=7.1] Remove this.

declare global {
	interface IteratorConstructor {
		/**
		 * The Iterator.concat() static method creates a new Iterator object from a list of iterable objects.
		 * The new iterator yields the values from each of the input iterables in sequence.
		 */
		concat<T>(...iterables: Iterable<T>[]): IteratorObject<
			T,
			undefined,
			unknown
		>;
	}
}
