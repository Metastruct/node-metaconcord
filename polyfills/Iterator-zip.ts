// TODO [engine:node@>=27]: Is Iterator.zip finally available now? Remove the polyfill if it is.

declare global {
	interface IteratorConstructor {
		/**
		 * Creates a new Iterator object that aggregates elements from multiple iterable objects by yielding arrays
		 * containing elements at the same position. It essentially "zips" the input iterables together,
		 * allowing simultaneous iteration over them.
		 * @param iterables An iterable of iterables whose elements are aggregated. It must be iterable and cannot be an iterator. It should be finite, although its elements can be infinite iterables. Each element must implement either the iterable protocol or, failing that, the iterator protocol. Strings are rejected: to zip strings, convert them to iterators explicitly using Iterator.from().
		 */
		zip<T, U>(iterables: readonly [Iterable<T>, Iterable<U>]): IterableIterator<[T, U]>;
	}

	var Iterator: IteratorConstructor;
}

class ImplementationCollisionError extends Error {}

if (typeof Iterator.zip === "function") {
	throw new ImplementationCollisionError("Iterator.zip already has an implementation!");
}

Object.defineProperty(Iterator, "zip", {
	*value<T, U>(iterables: readonly [Iterable<T>, Iterable<U>]) {
		const [left, right] = iterables;
		const leftIterator = left[Symbol.iterator]();
		const rightIterator = right[Symbol.iterator]();

		while (true) {
			const leftResult = leftIterator.next();
			const rightResult = rightIterator.next();

			if (leftResult.done || rightResult.done) {
				return;
			}

			yield [leftResult.value, rightResult.value];
		}
	},
	configurable: true,
	writable: true,
});

