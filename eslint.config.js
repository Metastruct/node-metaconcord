import typescriptEslintParser from '@typescript-eslint/parser';
import eslintJs from "@eslint/js";
import unicorn from 'eslint-plugin-unicorn';
import {defineConfig} from 'eslint/config';
import globals from 'globals';

export default defineConfig([
	{
		files: ['**/*.ts'],
		languageOptions: {
			globals: globals.nodeBuiltin,
			parser: typescriptEslintParser,
		},
		plugins: {
			unicorn, eslintJs
		},
		extends: [
			'eslintJs/recommended',
			'unicorn/recommended',
		],
		rules: {
			"unicorn/no-asterisk-prefix-in-documentation-comments": "off",
			"unicorn/filename-case": "off",
			"unicorn/name-replacements": "off",
			"unicorn/prefer-await": "off",
			"unicorn/prefer-string-raw": "off",
			"unicorn/no-null": "off",
			"unicorn/single-line-block-comment-style": "off",
			"unicorn/switch-case-braces": "off",
			"unicorn/consistent-boolean-name": "off",
			"unicorn/prefer-ternary": "off",
			"unicorn/no-nested-ternary": "off",
			"unicorn/prefer-unicode-code-point-escapes": "off",
			"unicorn/prefer-combined-guards": "off",
			//"unicorn/": "off",
			"unicorn/no-useless-undefined": "off",
			"unicorn/prefer-early-return": [
				"error",
				{
					"maximumStatements": 3
				}
			],
			"unicorn/prefer-number-properties": "off",
			"unicorn/no-for-each": "off",
			"no-unused-vars": [
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
			]
		},
	}
]);