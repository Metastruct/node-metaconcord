import net from "node:net";

// Per https://github.com/Cyberboss/BYOND.TopicSender (the library TGS itself
// uses to speak this protocol) - string and float are swapped from what
// their names suggest.
const PACKET_TYPE_STRING = 0x06;
const PACKET_TYPE_FLOAT = 0x2a;

/**
 * Sends a raw world.Topic() query straight to a BYOND game server (the same
 * port players connect to - DreamDaemon answers topic queries on its normal
 * listen port, this doesn't go through TGS at all) and returns the decoded
 * response. Implements BYOND's topic wire protocol directly since no
 * maintained npm package for it exists.
 */
export function queryTopic(
	host: string,
	port: number,
	query: string,
	timeoutMs = 5000
): Promise<string> {
	return new Promise((resolve, reject) => {
		const socket = new net.Socket();
		const chunks: Buffer[] = [];
		let settled = false;

		const settle = (fn: () => void) => {
			if (settled) return;
			settled = true;
			socket.destroy();
			fn();
		};

		socket.setTimeout(timeoutMs);
		socket.once("timeout", () =>
			settle(() => reject(new Error(`BYOND topic query to ${host}:${port} timed out`)))
		);
		socket.once("error", err => settle(() => reject(err)));
		socket.once("close", () =>
			settle(() =>
				reject(new Error(`BYOND topic connection to ${host}:${port} closed early`))
			)
		);

		socket.connect(port, host, () => {
			const body = Buffer.from(`?${query}\0`, "latin1");
			const header = Buffer.alloc(4);
			header.writeUInt8(0x00, 0);
			header.writeUInt8(0x83, 1);
			header.writeUInt16BE(body.length + 5, 2);
			socket.write(Buffer.concat([header, Buffer.alloc(5), body]));
		});

		socket.on("data", chunk => {
			chunks.push(chunk);
			const response = Buffer.concat(chunks);
			if (response.length < 4) return;

			if (response[0] !== 0x00 || response[1] !== 0x83) {
				return settle(() =>
					reject(new Error("BYOND topic response had an unexpected header"))
				);
			}

			const totalExpected = 4 + response.readUInt16BE(2);
			if (response.length < totalExpected) return;

			const type = response.readUInt8(4);
			settle(() => {
				if (type === PACKET_TYPE_STRING) {
					const end = response.indexOf(0, 5);
					resolve(response.toString("utf8", 5, end === -1 ? totalExpected : end));
				} else if (type === PACKET_TYPE_FLOAT) {
					// Floats are little-endian, unlike everything else in this protocol.
					resolve(String(response.readFloatLE(5)));
				} else {
					reject(
						new Error(`Unexpected BYOND topic response type 0x${type.toString(16)}`)
					);
				}
			});
		});
	});
}
