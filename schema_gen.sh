#!/usr/bin/env bash

rm -rf ./schemas/
mkdir ./schemas/
schemas=(
	'PayloadRequest'
	'ChatPayloadRequest'
)
requestspath='./bootstrap/providers/gamebridge/payloads/requests/'
for schema in ${schemas[@]}; do
	echo "Generating schema for $schema"
	npx typescript-json-schema "$requestspath*.ts" "$schema" --noExtraProps -o "$requestspath$schema.json"
done
