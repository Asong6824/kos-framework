import { existsSync, readFileSync, readdirSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { parseDocument } from "yaml";
import { parseFrontmatterFile } from "../validation/frontmatter.ts";
import { validateChangedFiles } from "../validation/validate.ts";
import { atomicWrite, resolveInsideRoot } from "./files.ts";
import { createObject } from "./create-object.ts";
import type { ObjectDirectories, OperationResult } from "./types.ts";

export interface ProcessSourceInput {
	query?: string;
	kind: "extract" | "summary";
	location?: string;
	directories: ObjectDirectories;
	dryRun?: boolean;
}

const INSUFFICIENT_MARKERS = ["正文尚未抓取", "补充原始正文", "访问限制", "验证码", "仅记录了来源元信息"];

export function processSource(root: string, input: ProcessSourceInput): OperationResult {
	const sourcePath = findSource(root, input.query);
	const source = resolveInsideRoot(root, sourcePath);
	const original = readFileSync(source.absolute, "utf8");
	const parsed = parseFrontmatterFile(source.absolute);
	if (!parsed.frontmatter || parsed.frontmatter.type !== "source") throw new Error(`Target is not a Source: ${source.relative}`);
	const title = String(parsed.frontmatter.title ?? source.relative.replace(/\.md$/, "").split("/").at(-1));
	const link = `[[${source.relative.replace(/\.md$/, "")}]]`;
	const result = createObject(root, {
		kind: input.kind,
		title,
		directories: input.directories,
		extra: input.kind === "extract"
			? { source: link, location: input.location ?? "", tags: ["extract"] }
			: { source: link, tags: ["summary"] },
		dryRun: input.dryRun,
	});
	if (input.dryRun) return result;
	const created = resolveInsideRoot(root, result.path);
	try {
		const match = /^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/.exec(original);
		if (!match) throw new Error(`Source has no frontmatter: ${source.relative}`);
		const document = parseDocument(match[1]);
		const createdLink = `[[${result.path.replace(/\.md$/, "")}]]`;
		document.set(input.kind === "extract" ? "extract_file" : "summary_file", createdLink);
		const insufficient = INSUFFICIENT_MARKERS.some((marker) => parsed.body.includes(marker));
		if (!insufficient && document.get("status") === "captured") {
			document.set("status", input.kind === "extract" ? "extracted" : "summarized");
		}
		atomicWrite(source.absolute, `---\n${document.toString().trim()}\n---\n${original.slice(match[0].length)}`);
		const validation = validateChangedFiles(root, [source.absolute, created.absolute]);
		if (!validation.passed) throw new Error(`Source processing validation failed: ${JSON.stringify(validation.findings)}`);
		return { path: result.path, validation };
	} catch (error) {
		atomicWrite(source.absolute, original);
		if (existsSync(created.absolute)) unlinkSync(created.absolute);
		throw error;
	}
}

function findSource(root: string, query?: string): string {
	const sources = markdownFiles(resolve(root, "11_原材料")).filter((path) => parseFrontmatterFile(path).frontmatter?.type === "source");
	if (!sources.length) throw new Error("未找到 Source 文件");
	if (!query) {
		const captured = sources.filter((path) => parseFrontmatterFile(path).frontmatter?.status === "captured");
		if (captured.length === 1) return relative(root, captured[0]);
		throw new Error("请提供 Source 路径或标题；当前无法唯一定位");
	}
	const direct = resolveInsideRoot(root, query);
	if (existsSync(direct.absolute)) return direct.relative;
	const matches = sources.filter((path) => {
		const fm = parseFrontmatterFile(path).frontmatter;
		return relative(root, path).includes(query) || String(fm?.title ?? "").includes(query);
	});
	if (matches.length !== 1) throw new Error(matches.length ? "匹配到多个 Source，请提供更精确路径" : `未找到匹配 Source：${query}`);
	return relative(root, matches[0]);
}

function markdownFiles(directory: string): string[] {
	if (!existsSync(directory)) return [];
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = resolve(directory, entry.name);
		return entry.isDirectory() ? markdownFiles(path) : entry.isFile() && path.endsWith(".md") ? [path] : [];
	}).sort();
}

function relative(root: string, path: string): string {
	return path.slice(resolve(root).length + 1).split("\\").join("/");
}
