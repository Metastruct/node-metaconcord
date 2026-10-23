import pkg from "websocket";
const { connection } = pkg;
const drop = connection.prototype.drop;

connection.prototype.drop = function(reasonCode, ...args) {
	if (reasonCode === connection.CLOSE_REASON_INVALID_DATA) {
		// console.warn("Would have dropped connection due to invalid UTF-8 data");
		return;
	}

	// eslint-disable-next-line unicorn/no-this-outside-of-class
	Reflect.apply(drop, this, [reasonCode, ...args]);
};
