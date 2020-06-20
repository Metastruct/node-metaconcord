#!/usr/bin/env bash

rm -rf ./schemas/
mkdir ./schemas/
schemas=(
	'PayloadRequest'
	'ChatPayloadRequest'
)
for schema in ${schemas[@]}; do
	echo "Generating schema for $schema"
	typescript-json-schema tsconfig.json "$schema" --noExtraProps -o "./schemas/$schema.json"
done