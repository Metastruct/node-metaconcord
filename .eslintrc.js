module.exports = {
	parser: "@typescript-eslint/parser",
	root: true,
	env: {
		node: true,
	},
	extends: ["eslint:recommended, plugin:@typescript-eslint/recommended", "plugin:prettier/recommended", "prettier"],
	// add your custom rules here
	rules: {
		"@typescript-eslint/no-explicit-any": "off",
		"no-console": "off",
		"no-prototype-builtins": "off",
		"nuxt/no-cjs-in-config": "off",
		"one-var": "off",
		"require-await": "off",
	},
};
