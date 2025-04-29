module.exports = {
	apps: [
		{
			script: "./dist/index.js",
			name: "metaconcord",
			time: true,
			max_restarts: 5,
		},
	],
};
