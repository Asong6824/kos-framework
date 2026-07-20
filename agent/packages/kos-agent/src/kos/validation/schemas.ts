import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import type { ObjectSchema } from "./types.ts";

let cachedSchemas: ReadonlyMap<string, ObjectSchema> | undefined;

export function loadObjectSchemas(): ReadonlyMap<string, ObjectSchema> {
	if (cachedSchemas) return cachedSchemas;
	const schemaDir = fileURLToPath(new URL("./schemas/", import.meta.url));
	const schemas = new Map<string, ObjectSchema>();
	for (const name of readdirSync(schemaDir).filter((entry) => entry.endsWith(".schema.yaml")).sort()) {
		const schema = parse(readFileSync(new URL(`./schemas/${name}`, import.meta.url), "utf8")) as ObjectSchema;
		if (!schema?.type || !Array.isArray(schema.paths) || !schema.required) {
			throw new Error(`Invalid kos object schema: ${name}`);
		}
		schemas.set(schema.type, schema);
	}
	cachedSchemas = schemas;
	return schemas;
}

export function resetSchemaCacheForTests(): void {
	cachedSchemas = undefined;
}
