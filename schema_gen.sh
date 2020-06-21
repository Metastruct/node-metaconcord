#!/usr/bin/env bash

requestspath='./bootstrap/providers/gamebridge/payloads/structures/'
if [[ ! -d $requestspath ]]; then
	echo "$requestspath doesn't exist"
	exit 1
fi
rm -rf $requestspath*.json
for schema in $requestspath*.ts; do
	schema=$(basename $schema)
	schema=${schema/%.ts/}
	if [[ $schema == "index" ]]; then continue; fi
	echo "Generating schema for $schema"
	npx typescript-json-schema "$requestspath*.ts" "$schema" --noExtraProps -o "$requestspath$schema.json"
done
