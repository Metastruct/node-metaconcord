#!/usr/bin/env bash

gen_schemas() {
	local requestspath=$1
	if [[ ! -d $requestspath ]]; then
		echo "$requestspath doesn't exist"
		exit 1
	fi

	# newer ts-json-schema-generator versions need a real ts project to resolve
	# the .js-suffixed imports between structures, so generate a throwaway one
	local tsconfig
	tsconfig=$(mktemp --suffix=.json)
	cat >"$tsconfig" <<-EOF
	{
		"compilerOptions": {
			"target": "ES2022",
			"module": "NodeNext",
			"moduleResolution": "nodenext",
			"strict": true,
			"noEmit": true
		},
		"include": ["$(realpath $requestspath)/*.ts"]
	}
	EOF

	rm -rf $requestspath*.json
	for schema in $requestspath*.ts; do
		schema=$(basename $schema)
		schema=${schema/%.ts/}
		if [[ $schema == "index" ]]; then continue; fi
		echo "Generating schema for $schema"
		yarn dlx ts-json-schema-generator --tsconfig "$tsconfig" -p "$requestspath*.ts" -t "$schema" -o "$requestspath$schema.json"
	done
	rm -f "$tsconfig"
}

gen_schemas './app/services/gamebridge/games/gmod/handlers/structures/'
gen_schemas './app/services/gamebridge/games/minecraft/handlers/structures/'
