import { connection } from "websocket";

const drop = connection.prototype.drop;

connection.prototype.drop = function (reasonCode, ...args) {
	if (reasonCode == connection.CLOSE_REASON_INVALID_DATA) {
		// console.warn("Would have dropped connection due to invalid UTF-8 data");
		return;
	}

	drop.apply(this, [reasonCode, ...args]);
};
