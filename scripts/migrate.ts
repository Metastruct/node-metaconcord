#!/usr/bin/env node

import { makeMigration, migrate } from "#lib/kyselyMigrator";
import { LocalDB } from "#/app/services/index.ts";

const command = process.argv[2] ?? "latest";
const argv = process.argv.slice(3);
const argc = argv.length;

function validateUsage(min: number, max: number, usage: string) {
	if (argc < min)
		throw new Error(`${command}: Not enough parameters: min ${min} expected, ${argc} received.\nUsage: ${usage}`);
	if (argc > max)
		throw new Error(`${command}: Too many parameters: max ${max} expected, ${argc} received.\nUsage: ${usage}`);
}

function usage(...options: string[]) {
	return `scripts/migrate.ts ${options.length > 1 ? "[" : ""}${options.join("|")}${options.length > 1 ? "]" : ""}`;
}

const usageFor = {
	make: usage("make <migration name>"),
	latestUpDown: usage("latest", "up", "down"),
} as const;

try {
	switch (command) {
		case "make":
			validateUsage(1, 1, usageFor.make);
			makeMigration(argv[0]);
			break;
		case "latest":
		case "up":
		case "down":
			validateUsage(0, 0, usageFor.latestUpDown);
			await migrate(command, LocalDB.db);
			break;
		default:
			throw new Error(`Usage: ${usageFor.latestUpDown}\n       ${usageFor.make}`);
	}
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
	process.exit(-1);
}
