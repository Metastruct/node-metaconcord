import globals from "globals";
import unicorn from "eslint-plugin-unicorn";
import stylistic from "@stylistic/eslint-plugin";
import eslintJs from "@eslint/js";
import { defineConfig } from "eslint/config";
import { parser as tsParser, plugin as tsPlugin, configs as tsConfigs } from "typescript-eslint";

export default defineConfig([
	{
		ignores: ["dist/"],
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
			"typescript-eslint": tsPlugin,
		},
		extends: [
			"eslintJs/recommended",
			"unicorn/recommended",
		],
		rules: {
			// Disabled temporarily until fixed.
			"unicorn/prefer-module": "off",

			// Disabled for now, maybe they can be enabled some time?
			"unicorn/filename-case": "off", // Will change a lot of paths, fix everything else first for simpler merging.
			"unicorn/no-anonymous-default-export": "off", // Recommended to look into `unicorn/filename-case` first.
			"unicorn/consistent-class-member-order": "off", // Could be a good idea, but it's a bit of work.
			"unicorn/consistent-boolean-name": "off", // Generally cool, but could be some work to figure out if the changes would be visible externally (via APIs?)
			"unicorn/name-replacements": "off", // Good idea, needs some configuring work. Also see above.
			
			// Base ESLint rules not in eslintJs/recommended that we add into the mix
			"radix": "error",

			// Base ESLint rules that conflict or should not be used in general.
			"no-redeclare": "off",
			
			// Disabled for aesthetic reasons:
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
			"unicorn/no-declarations-before-early-exit": "off",
			"unicorn/no-null": "off",
			"unicorn/no-top-level-assignment-in-function": "off",
			"unicorn/no-top-level-side-effects": "off",
			"unicorn/prefer-await": "off",
			"unicorn/prefer-event-target": "off",
			
			// Disabled: Necessary evil in order to keep this code relatively fun to work with, without requiring seminars:
			"unicorn/max-nested-calls": "off",
			"unicorn/no-array-callback-reference": "off",
			"unicorn/no-await-expression-member": "off",
			"unicorn/no-break-in-nested-loop": "off",
			"unicorn/no-new-array": "off",
			"unicorn/no-unsafe-string-replacement": "off",
			"unicorn/prefer-regexp-test": "off",
			
			// Demoted to warning: Sometimes violating these makes sense for aesthetic reasons:
			"unicorn/prefer-simple-condition-first": "warn",

			/**
			 * DOM rules
			 */

			// Disabled for aesthetic reasons:
			"unicorn/prefer-dom-node-append": "off",

			// Demoted to warning: a bit annoying to deal with without investigating further:
			"unicorn/prefer-scoped-selector": "warn",

			/**
			 * Custom settings area
			 */

			"no-unused-vars": "off",
			"typescript-eslint/no-unused-vars": [
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
			
			"eqeqeq": [
				"error",
				"always",
			],

			"typescript-eslint/no-explicit-any": "warn",

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
			 * Stylistic rules (only used for aesthetics and formatting)
			 */
			
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
]);
