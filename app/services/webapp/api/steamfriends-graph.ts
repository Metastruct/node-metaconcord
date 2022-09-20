import { Friend } from "steamapi";
import { Steam, WebApp } from "@/app/services";
import SteamID from "steamid";
import cors from "cors";
let pLimit;
(async () => {
	pLimit = (await import("p-limit")).default;
})();

type FriendCache = {
	expireTime: number;
	friends: Friend[];
};
const validTime = 30 * 60 * 1000;
const friendsCache: { [key: string]: FriendCache } = {};

type SteamFriend = {
	steamId: string;
	friends: SteamFriend[];
};

const getUserFriends = async (steamId: string, steam: Steam) => {
	const cache = friendsCache[steamId];
	if (!cache || cache.expireTime < Date.now()) {
		friendsCache[steamId] = {
			expireTime: Date.now() + validTime,
			friends: await steam.api.getUserFriends(steamId).catch(() => []),
		};
	}
	return friendsCache[steamId].friends;
};
const MAX_DEPTH = 2; // More than 1 is actually... madness
const getSteamFriendsGraph = async (
	graph: SteamFriend[],
	steam: Steam,
	limit: any,
	traversed: Set<string> = new Set(),
	i = 0
): Promise<SteamFriend[]> => {
	i = i + 1;
	if (i > MAX_DEPTH) {
		return graph;
	}

	console.log(`Current depth: ${i} / ${MAX_DEPTH}`);

	await Promise.all(
		graph.map(user =>
			limit(async () => {
				if (traversed.has(user.steamId)) {
					console.log(`Already traversed ${user.steamId}`);
					return;
				}
				traversed.add(user.steamId);
				console.log(`Fetching friends for ${user.steamId}`);
				const userFriends = await getUserFriends(user.steamId, steam);
				const friends = userFriends.map(friend => {
					return {
						steamId: friend.steamID,
						friends: [],
					};
				});
				user.friends = await getSteamFriendsGraph(friends, steam, limit, traversed, i);
			})
		)
	);

	return graph;
};

export default async (webApp: WebApp): Promise<void> => {
	const steam = webApp.container.getService("Steam");
	if (!steam) return;

	webApp.app.get("/steamfriends-graph/api/:id?", cors(), async (req, res) => {
		if (!pLimit) return res.status(500);

		const steamId = req.params.id;
		if (!steamId || !new SteamID(steamId).isValid())
			return res.status(400).send("No SteamID64 provided");

		const [user] = await getSteamFriendsGraph([{ steamId, friends: [] }], steam, pLimit(5)).catch(
			err => {
				console.error(err);
				return [];
			}
		);

		return res.status(200).json(user);
	});
};
