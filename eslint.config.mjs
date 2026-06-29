// @ts-check

import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default defineConfig([
	{
		ignores: ["dist/**", ".yarn/**"],
	},
	{
		files: ["**/*.{js,ts}"],
		extends: [js.configs.recommended, tseslint.configs.recommended],
		rules: {
			"no-empty": ["warn", { allowEmptyCatch: true }],
		},
	},
	prettier,
]);
