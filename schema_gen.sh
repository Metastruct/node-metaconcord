#!/usr/bin/env bash

requestspath='./bootstrap/providers/gamebridge/payloads/requests/'
rm -rf "$requestspath*.json"
for schema in $requestspath*.ts; do
	schema=$(basename $schema)
	schema=${schema/%.ts/}
	echo "Generating schema for $schema"
	npx typescript-json-schema "$requestspath*.ts" "$schema" --noExtraProps -o "$requestspath$schema.json"
done
