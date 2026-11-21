// @ts-check

import noUnexecutedQuery from "./no-unexecuted-query.js";

/** @satisfies {import('eslint').ESLint.Plugin} */
const plugin = {
	rules: {
		"no-unexecuted-query": noUnexecutedQuery,
	},
};

export default plugin;
