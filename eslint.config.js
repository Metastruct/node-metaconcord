import eslintJs from "@eslint/js";
import stylistic from "@stylistic/eslint-plugin";
import globals from "globals";
import typescriptEslint from "typescript-eslint";

export default [
	eslintJs.configs.recommended,
	...typescriptEslint.configs.recommended,
	{
		ignores: [
			"dist",
			"resources"
		]
	},
	{
		languageOptions: {
			globals: {
				...globals.node
			}
		},
		plugins: {
			"@stylistic": stylistic
		},
		rules: {
			"@stylistic/indent": [
				"error",
				"tab",
				{
					"flatTernaryExpressions": true
				}
			],
			"@stylistic/eol-last": [
				"error"
			],
			"@stylistic/linebreak-style": [
				"error",
				"unix"
			],
			"@stylistic/quotes": [
				"error",
				"double",
				{
					"avoidEscape": true
				}
			],
			"@stylistic/semi": [
				"error",
				"always"
			],
			"eqeqeq": [
				"warn",
				"always"
			],
			"no-empty": [
				"error",
				{
					"allowEmptyCatch": true
				}
			],
			"@typescript-eslint/no-explicit-any": "warn",
			"@typescript-eslint/no-unused-vars": [
				"warn",
				{
					args: "all",
					argsIgnorePattern: "^_",
					caughtErrors: "all",
					caughtErrorsIgnorePattern: "^_",
					destructuredArrayIgnorePattern: "^_",
					varsIgnorePattern: "^_",
					ignoreRestSiblings: true
				}
			],
			"@stylistic/space-before-function-paren": [
				"error",
				{
					anonymous: "never",
					named: "never",
					asyncArrow: "always",
					catch: "always"
				}
			],
			"@stylistic/function-call-spacing": [
				"error",
				"never"
			]
		}
	},
	{
		files: ["**/*.ts"],
		languageOptions: {
			parser: typescriptEslint.parser,
			parserOptions: {
				project: "tsconfig.json"
			}
		},
		rules: {
			"@typescript-eslint/switch-exhaustiveness-check": "warn"
		}
	}
];
