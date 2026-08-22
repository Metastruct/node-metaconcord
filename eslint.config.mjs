// @ts-check

import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default defineConfig([
	{
		ignores: ["dist/**", ".yarn/**"],
	},
	{
		files: ["**/*.{js,ts}"],
		extends: [js.configs.recommended, tseslint.configs.recommended],
		rules: {
			"no-empty": ["warn", { allowEmptyCatch: true }],
			"@typescript-eslint/no-unused-vars": [
				"error",
				{ argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
			],
		},
	},
	{
		files: ["resources/**/*.js"],
		languageOptions: { globals: globals.browser },
	},
	prettier,
]);
