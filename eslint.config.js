import eslintJs from "@eslint/js";
import stylistic from "@stylistic/eslint-plugin";
import { defineConfig } from "eslint/config";
import packageJson from "eslint-package-json";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import unicorn from "eslint-plugin-unicorn";
import globals from "globals";
import { configs as tsConfigs, parser as tsParser, plugin as tsPlugin } from "typescript-eslint";

export default defineConfig([
	{
		ignores: ["dist/", "generated/"],
	},
	{
		files: ["!resources/**"],
		languageOptions: {
			globals: globals.nodeBuiltin,
		},
	},
	{
		files: ["resources/**"],
		languageOptions: {
			globals: globals.browser,
		},
	},
	{
		files: ["**/*.?(c|m)@(ts|js)"],
		languageOptions: {
			parser: tsParser,
			parserOptions: {
				projectService: true,
			},
		},
		plugins: {
			unicorn,
			stylistic,
			eslintJs,
			"@typescript-eslint": tsPlugin,
			"simple-import-sort": simpleImportSort,
		},
		extends: [
			"eslintJs/recommended",
			"@typescript-eslint/recommended-type-checked",
			"unicorn/recommended",
		],
		rules: {
			//#region Disabled Rules

			// Disabled for now, maybe they can be enabled some time?
			"@typescript-eslint/no-array-delete": "off", // Only used for GameBridge.servers.
			"@typescript-eslint/no-unsafe-return": "off", // RemoteDB is untyped.
			"unicorn/consistent-boolean-name": "off", // Generally cool, but could be some work to figure out if the changes would be visible externally (via APIs?)
			"unicorn/consistent-class-member-order": "off", // Could be a good idea, but it's a bit of work.
			"unicorn/filename-case": "off", // Will change a lot of paths, fix everything else first for simpler merging.
			"unicorn/name-replacements": "off", // Good idea, needs some configuring work. Also see above.

			// Disabled for aesthetic reasons:
			"@typescript-eslint/restrict-template-expressions": "off",
			"unicorn/import-style": "off",
			"unicorn/no-array-reduce": "off",
			"unicorn/no-asterisk-prefix-in-documentation-comments": "off",
			"unicorn/no-computed-property-existence-check": "off",
			"unicorn/no-for-each": "off",
			"unicorn/no-unreadable-for-of-expression": "off",
			"unicorn/prefer-combined-guards": "off",
			"unicorn/prefer-continue": "off",
			"unicorn/prefer-includes-over-repeated-comparisons": "off",
			"unicorn/prefer-smaller-scope": "off",
			"unicorn/prefer-spread": "off",
			"unicorn/prefer-string-raw": "off",
			"unicorn/prefer-ternary": "off",
			"unicorn/single-line-block-comment-style": "off",
			"unicorn/switch-case-braces": "off",

			// Disabled: Heavy refactoring work would be required:
			"@typescript-eslint/no-unsafe-argument": "off",
			"@typescript-eslint/no-unsafe-assignment": "off",
			"@typescript-eslint/no-unsafe-member-access": "off",
			"@typescript-eslint/require-await": "off",
			"unicorn/no-declarations-before-early-exit": "off",
			"unicorn/no-null": "off",
			"unicorn/no-top-level-assignment-in-function": "off",
			"unicorn/no-top-level-side-effects": "off",
			"unicorn/prefer-await": "off",
			"unicorn/prefer-event-target": "off",

			// Disabled: Necessary evil in order to keep this code relatively fun to work with, without requiring seminars:
			"@typescript-eslint/no-base-to-string": "off",
			"@typescript-eslint/no-floating-promises": "off",
			"@typescript-eslint/no-misused-promises": "off",
			"unicorn/max-nested-calls": "off",
			"unicorn/no-array-callback-reference": "off",
			"unicorn/no-await-expression-member": "off",
			"unicorn/no-break-in-nested-loop": "off",
			"unicorn/no-new-array": "off",
			"unicorn/no-unsafe-string-replacement": "off",
			"unicorn/prefer-regexp-test": "off",

			//#endregion

			//#region Enabled Rules

			// Base ESLint rules not in eslintJs/recommended that we add into the mix
			"radix": "error",
			"eqeqeq": ["error", "always" ],

			// Enable some rules not relected by the recommended config:
			//"@typescript-eslint/no-deprecated": "warn", // TODO: turn this on
			"@typescript-eslint/no-misused-spread": "error",
			"@typescript-eslint/no-unnecessary-template-expression": "error",

			// Rules demoted to warning:
			"unicorn/prefer-simple-condition-first": "warn", // Sometimes violating these makes sense for aesthetic reasons:

			/*
			 * Rules that require more complex configuration.
			 */

			"@typescript-eslint/no-unused-vars": [
				"warn",
				{
					args: "all",
					argsIgnorePattern: "^_",
					caughtErrors: "all",
					caughtErrorsIgnorePattern: "^_",
					destructuredArrayIgnorePattern: "^_",
					varsIgnorePattern: "^_",
					ignoreRestSiblings: true,
				},
			],

			"@typescript-eslint/consistent-type-imports": [
				"error",
				{
					"fixStyle": "inline-type-imports",
				},
			],

			"simple-import-sort/imports": [
				"error",
				{
					"groups": [[
						// Side effect imports.
						"^\\u0000",
						// Node.js builtins prefixed with `node:`.
						"^node:",
						// Packages.
						// Things that start with a letter (or digit or underscore), or `@`/`#` followed by a letter.
						"^@?\\w",
					],
					[
						// Absolute imports.
						"^#",
						"^#/",
						// All other imports; Anything not matched in another group.
						"^",
						// Relative imports.
						// Anything that starts with a dot.
						"^\\.",
					],
					[
						// Config imports.
						"^#config",
					],
					]},
			],

			"unicorn/expiring-todo-comments": [
				"warn",
				{
					"allowWarningComments": false,
				},
			],
			"unicorn/prefer-early-return": [
				"error",
				{
					"maximumStatements": 3, // seems like a good trade-off
				},
			],
			"unicorn/prefer-https": [
				"error",
				{
					ignore: [
						/^http:\/\/specs\.openid\.net\//,
					],
				},
			],
			"unicorn/no-useless-undefined": [
				"error",
				{
					"checkArrowFunctionBody": false,
				},
			],

			/**
			 * DOM rules (pretty much only used for the dashboard)
			 */

			// Disabled for aesthetic reasons:
			"unicorn/prefer-dom-node-append": "off",

			// Demoted to warning: a bit annoying to deal with without investigating further:
			"unicorn/prefer-scoped-selector": "warn",

			//#endregion

			//#region Stylistic Rules

			// These are all only used for aesthetics and formatting.

			"stylistic/indent": [
				"error",
				"tab",
				{
					"flatTernaryExpressions": true,
				},
			],
			"stylistic/eol-last": [
				"error",
			],
			"stylistic/linebreak-style": [
				"error",
				"unix",
			],
			"stylistic/quotes": [
				"error",
				"double",
				{
					"avoidEscape": true,
				},
			],
			"stylistic/semi": [
				"error",
				"always",
			],
			"stylistic/comma-dangle": [
				"error",
				{
					"arrays": "always-multiline",
					"objects": "always-multiline",
					"imports": "always-multiline",
					"exports": "always-multiline",
					"functions": "only-multiline", // Allow but don't require.
					"importAttributes": "always-multiline",
					"dynamicImports": "always-multiline",
					"enums": "always-multiline",
					"generics": "always-multiline",
					"tuples": "always-multiline",
				},
			],
			"stylistic/space-before-function-paren": [
				"error",
				{
					anonymous: "never",
					named: "never",
					asyncArrow: "always",
					catch: "always",
				},
			],
			"stylistic/function-call-spacing": [
				"error",
				"never",
			],
			"stylistic/no-trailing-spaces": "error",

			//#endregion
		},
	},
	{
		// Disable type-checked linting for non-TypeScript files.
		// Otherwise, we would need to either add them to tsconfig or enable allowJs or checkJs.
		// Alternatively, they could be added as out-of-project files to allowDefaultProject in parserOptions, but this can be slow.
		files: ["**/*.?(c|m)js"],
		extends: [tsConfigs.disableTypeChecked],
	},
	{
		files: ["test/**"],
		rules: {
			"unicorn/consistent-function-scoping": "off",
		},
	},
	{
		files: ["migrations/**"],
		rules: {
			"@typescript-eslint/no-explicit-any": "off",
			"@typescript-eslint/no-unsafe-call": "off",
		},
	},
	{
		files: ["**/package.json"],
		plugins: {
			"package-json": packageJson,
		},
		extends: [
			"package-json/recommended",
		],
		rules: {
			"package-json/consistent-name-casing": "error",
			"package-json/require-private": "error",
			"package-json/restrict-fields-when-private": "error",
			"package-json/sort-scripts": "error",
			"package-json/types-in-dev-dependencies": "error",
		},
	},
]);
