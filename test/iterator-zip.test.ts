import assert from "node:assert/strict";
import test from "node:test";

import "#/polyfills/Iterator-zip.js";

test("Iterator.zip pairs values from two arrays in order", () => {
	assert.deepEqual(
		[...Iterator.zip([[1, 2, 3], ["a", "b", "c"]])],
		[
			[1, "a"],
			[2, "b"],
			[3, "c"],
		]
	);
});

test("Iterator.zip stops when the left iterable ends", () => {
	assert.deepEqual(
		[...Iterator.zip([[1, 2], ["a", "b", "c"]])],
		[
			[1, "a"],
			[2, "b"],
		]
	);
});

test("Iterator.zip stops when the right iterable ends", () => {
	assert.deepEqual(
		[...Iterator.zip([[1, 2, 3], ["a", "b"]])],
		[
			[1, "a"],
			[2, "b"],
		]
	);
});

test("Iterator.zip accepts non-array iterables", () => {
	const left = new Set([1, 2, 3]);
	function* right(): IterableIterator<string> {
		yield "x";
		yield "y";
		yield "z";
	}

	assert.deepEqual([...Iterator.zip([left, right()])], [[1, "x"], [2, "y"], [3, "z"]]);
});

test("Iterator.zip returns a lazy iterable iterator", () => {
	let nextCalls = 0;
	const left = {
		[Symbol.iterator](): Iterator<number> {
			return {
				next() {
					nextCalls++;
					return nextCalls <= 2
						? { value: nextCalls, done: false }
						: { value: undefined, done: true };
				},
			};
		},
	};

	const zipped = Iterator.zip([left, ["a", "b"]]);
	assert.equal(nextCalls, 0);
	assert.deepEqual(zipped.next(), { value: [1, "a"], done: false });
	assert.equal(nextCalls, 1);
	assert.deepEqual(zipped.next(), { value: [2, "b"], done: false });
	assert.equal(nextCalls, 2);
	assert.deepEqual(zipped.next(), { value: undefined, done: true });
	assert.equal(nextCalls, 3);
});

test("Iterator.zip handles empty iterables", () => {
	assert.deepEqual([...Iterator.zip([[], []])], []);
	assert.deepEqual([...Iterator.zip([[], [1, 2, 3]])], []);
	assert.deepEqual([...Iterator.zip([[1, 2, 3], []])], []);
});
