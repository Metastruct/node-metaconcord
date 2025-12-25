#!/usr/bin/env bash

requestspath='./app/services/gamebridge/payloads/structures/'
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
	yarn dlx ts-json-schema-generator -p "$requestspath*.ts" -t "$schema" -o "$requestspath$schema.json"
done
