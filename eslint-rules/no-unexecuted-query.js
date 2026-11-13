import { extname } from "node:path";
import { ESLintUtils } from "@typescript-eslint/utils";

/* eslint-disable unicorn/no-useless-recursion */

function unwrap(node) {
	switch (node.type) {
		case "TSAsExpression":
		case "TSTypeAssertion":
		case "TSNonNullExpression":
		case "TSSatisfiesExpression":
		case "ChainExpression":
			return unwrap(node.expression);

		case "UnaryExpression":
			return node.operator === "void" ? unwrap(node.argument) : node;

		default:
			return node;
	}
}

const typescriptExtensions = new Set([".ts", ".tsx", ".mts", ".cts"]);

/** @type {import('eslint').Rule.RuleModule} */
export default {
	meta: {
		type: "problem",
		docs: {
			description: "Disallow discarded, unexecuted Kysely query builders",
		},
		schema: [],
		messages: {
			unexecuted:
        "This query has not been executed. Call .execute(), " +
        ".executeTakeFirst(), or another execution method.",
			awaitedBuilder:
        "Awaiting a query builder does not execute it. " +
        "Call an execution method before awaiting it.",
		},
	},

	create(context) {
		const extension = extname(context.filename).toLowerCase();

		if (!typescriptExtensions.has(extension)) {
			return {};
		}

		const services = ESLintUtils.getParserServices(context);
		const checker = services.program.getTypeChecker();

		function hasMethod(type, name, location) {
			const property = checker.getPropertyOfType(type, name);

			if (!property) {
				return false;
			}

			const propertyType = checker.getTypeOfSymbolAtLocation(
				property,
				location,
			);

			return propertyType.getCallSignatures().length > 0;
		}

		function isQueryBuilderType(type, location) {
			// Treat a union as a potential query builder if any branch is one.
			if (type.isUnion()) {
				return type.types.some((member) =>
					isQueryBuilderType(member, location),
				);
			}

			// Resolve generic constraints where available.
			const constraint = checker.getBaseConstraintOfType(type);

			if (constraint && constraint !== type) {
				return isQueryBuilderType(constraint, location);
			}

			// Structural detection covers select/insert/update/delete,
			// schema builders, and raw SQL builders.
			return ["execute", "compile", "toOperationNode"].every((name) =>
				hasMethod(type, name, location),
			);
		}

		function isQueryBuilder(node) {
			const tsNode = services.esTreeNodeToTSNodeMap.get(node);
			const type = checker.getTypeAtLocation(tsNode);

			return isQueryBuilderType(type, tsNode);
		}

		return {
			ExpressionStatement(node) {
				const expression = unwrap(node.expression);

				// Handled by the AwaitExpression visitor.
				if (expression.type === "AwaitExpression") {
					return;
				}

				if (isQueryBuilder(expression)) {
					context.report({
						node: expression,
						messageId: "unexecuted",
					});
				}
			},

			AwaitExpression(node) {
				const argument = unwrap(node.argument);

				if (isQueryBuilder(argument)) {
					context.report({
						node,
						messageId: "awaitedBuilder",
					});
				}
			},
		};
	},
};
