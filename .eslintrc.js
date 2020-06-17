module.exports = {
	parser: "@typescript-eslint/parser",
	root: true,
	env: {
		node: true,
	},
	extends: [
		"plugin:@typescript-eslint/recommended",
		"prettier/@typescript-eslint",
		"plugin:prettier/recommended",
	],
	// add your custom rules here
	rules: {
		"nuxt/no-cjs-in-config": "off",
		"no-console": "off",
		"max-len": ["off", 80, 4],
		"no-prototype-builtins": "off",
		"require-await": "off",
		"one-var": "off",
		"import/order": "off",
	},
};
