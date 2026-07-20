import { readFileSync } from "node:fs";
import { parse } from "yaml";

const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/;

export interface ParsedFrontmatterDocument {
	frontmatter: Record<string, unknown> | null;
	body: string;
	parseError?: string;
}

export function parseFrontmatterFile(path: string): ParsedFrontmatterDocument {
	const text = readFileSync(path, "utf8");
	const match = FRONTMATTER_RE.exec(text);
	if (!match) return { frontmatter: null, body: text };
	try {
		const value = parse(match[1]) as unknown;
		return {
			frontmatter: value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {},
			body: text.slice(match[0].length),
		};
	} catch (error) {
		return {
			frontmatter: {},
			body: text.slice(match[0].length),
			parseError: error instanceof Error ? error.message : String(error),
		};
	}
}
