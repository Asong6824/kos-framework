import { createHash } from "node:crypto";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { parseDocument } from "yaml";
import { parseFrontmatterFile } from "../validation/frontmatter.ts";
import { validateChangedFiles } from "../validation/validate.ts";
import { createObject, sanitizeFileName } from "./create-object.ts";
import { atomicWrite, resolveInsideRoot } from "./files.ts";
import type { AppendReaderExtractInput, AppendReaderExtractResult } from "./types.ts";

const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/;
const MAX_SELECTION_LENGTH = 20_000;

function normalizeSelection(text: string): string {
	return text
		.replace(/\u00a0/g, " ")
		.replace(/\r\n?/g, "\n")
		.split("\n")
		.map((line) => line.replace(/[ \t]+/g, " ").trim())
		.join("\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

function wikiPath(value: unknown): string | null {
	if (typeof value !== "string" || !value.trim()) return null;
	let result = value.trim();
	if (result.startsWith("[[") && result.endsWith("]]")) result = result.slice(2, -2).split("|", 1)[0];
	result = result.split("#", 1)[0].replace(/^\/+/, "");
	return result.endsWith(".md") ? result : `${result}.md`;
}

function sourceLink(sourcePath: string): string {
	return `[[${sourcePath.replace(/\.md$/i, "")}]]`;
}

function documentLink(documentPath: string): string {
	return `[[${documentPath.replace(/\.md$/i, "")}]]`;
}

function updateFrontmatter(content: string, update: (document: ReturnType<typeof parseDocument>) => void): string {
	const match = FRONTMATTER_RE.exec(content);
	if (!match) throw new Error("Markdown file has no frontmatter");
	const document = parseDocument(match[1]);
	if (document.errors.length) throw new Error(`Invalid frontmatter: ${document.errors[0].message}`);
	update(document);
	return `---\n${document.toString().trim()}\n---\n${content.slice(match[0].length)}`;
}

function quote(text: string): string {
	return text.split("\n").map((line) => `> ${line}`).join("\n");
}

function extractBlock(input: AppendReaderExtractInput, id: string, text: string): string {
	const position = input.positionLabel.trim() || input.location.trim();
	return [
		`<!-- kos-reader-extract:start ${id} -->`,
		quote(text),
		"",
		`- 位置：${position}`,
		`- 原文件：${documentLink(input.documentPath)}`,
		`^${id}`,
		`<!-- kos-reader-extract:end ${id} -->`,
	].join("\n");
}

function appendToExtract(content: string, block: string): string {
	const heading = /^## 摘录内容\s*$/m.exec(content);
	if (!heading) return `${content.trimEnd()}\n\n## 摘录内容\n\n${block}\n`;
	const sectionStart = heading.index + heading[0].length;
	const nextHeading = /^## /m.exec(content.slice(sectionStart));
	const sectionEnd = nextHeading ? sectionStart + nextHeading.index : content.length;
	let section = content.slice(sectionStart, sectionEnd);
	section = section.replace(/^\s*> 保留原文表达，不混入个人解释。\s*$/m, "").trim();
	const replacement = `\n\n${section ? `${section}\n\n` : ""}${block}\n\n`;
	return `${content.slice(0, sectionStart)}${replacement}${content.slice(sectionEnd).replace(/^\n+/, "")}`;
}

function associatedExtract(root: string, sourcePath: string, reference: unknown): string | null {
	const path = wikiPath(reference);
	if (!path) return null;
	const target = resolveInsideRoot(root, path);
	if (!existsSync(target.absolute)) return null;
	const frontmatter = parseFrontmatterFile(target.absolute).frontmatter;
	if (frontmatter?.type !== "extract") throw new Error(`Source extract_file is not an Extract: ${target.relative}`);
	const referencedSource = wikiPath(frontmatter.source);
	if (!referencedSource || resolveInsideRoot(root, referencedSource).relative !== sourcePath) {
		throw new Error(`Extract points to another Source: ${target.relative}`);
	}
	return target.relative;
}

function createExtract(root: string, input: AppendReaderExtractInput, title: string): string {
	const directory = input.directories.extract ?? "20_处理区/摘录";
	const base = sanitizeFileName(title) || "未命名来源";
	for (let suffix = 1; suffix < 10_000; suffix += 1) {
		const candidateTitle = suffix === 1 ? base : `${base} (${suffix})`;
		const candidate = resolveInsideRoot(root, `${directory}/${sanitizeFileName(candidateTitle)}_摘录.md`);
		if (existsSync(candidate.absolute)) {
			const frontmatter = parseFrontmatterFile(candidate.absolute).frontmatter;
			if (frontmatter?.type === "extract" && wikiPath(frontmatter.source) === input.sourcePath) return candidate.relative;
			continue;
		}
		return createObject(root, {
			kind: "extract",
			title: candidateTitle,
			directories: input.directories,
			extra: {
				source: sourceLink(input.sourcePath),
				location: input.positionLabel.trim() || input.location.trim(),
				extracted_by: "human",
				review_status: "pending",
				tags: ["reader"],
			},
		}).path;
	}
	throw new Error("Unable to allocate an Extract filename");
}

export function appendReaderExtract(root: string, input: AppendReaderExtractInput): AppendReaderExtractResult {
	if (!new Set(["markdown", "pdf", "epub"]).has(input.kind)) throw new Error(`Unsupported Reader kind: ${input.kind}`);
	const text = normalizeSelection(input.text);
	if (!text) throw new Error("Reader selection is empty");
	if (text.length > MAX_SELECTION_LENGTH) throw new Error(`Reader selection exceeds ${MAX_SELECTION_LENGTH} characters`);
	if (!input.location.trim()) throw new Error("Reader selection location is required");

	const source = resolveInsideRoot(root, input.sourcePath);
	const document = resolveInsideRoot(root, input.documentPath);
	if (!existsSync(source.absolute)) throw new Error(`Source does not exist: ${source.relative}`);
	if (!existsSync(document.absolute)) throw new Error(`Reader document does not exist: ${document.relative}`);
	const parsedSource = parseFrontmatterFile(source.absolute);
	if (parsedSource.frontmatter?.type !== "source") throw new Error(`Target is not a Source: ${source.relative}`);
	const title = String(parsedSource.frontmatter.title ?? source.relative.replace(/\.md$/, "").split("/").at(-1));
	const id = `kos-reader-${createHash("sha256")
		.update([source.relative, document.relative, input.kind, input.location, text].join("\0"))
		.digest("hex").slice(0, 16)}`;

	const sourceOriginal = readFileSync(source.absolute, "utf8");
	let extractPath = associatedExtract(root, source.relative, parsedSource.frontmatter.extract_file);
	let created = false;
	if (!extractPath) {
		extractPath = createExtract(root, { ...input, sourcePath: source.relative, documentPath: document.relative }, title);
		created = true;
	}
	const extract = resolveInsideRoot(root, extractPath);
	const extractOriginal = readFileSync(extract.absolute, "utf8");
	const marker = `<!-- kos-reader-extract:start ${id} -->`;
	if (extractOriginal.includes(marker)) {
		return {
			path: extract.relative,
			extractId: id,
			created: false,
			duplicate: true,
			validation: validateChangedFiles(root, [source.absolute, extract.absolute]),
		};
	}

	try {
		let extractContent = appendToExtract(extractOriginal, extractBlock(input, id, text));
		extractContent = updateFrontmatter(extractContent, (frontmatter) => {
			const extractedBy = String(frontmatter.get("extracted_by") ?? "human");
			frontmatter.set("extracted_by", extractedBy === "human" ? "human" : "mixed");
			frontmatter.set("source", sourceLink(source.relative));
			if (!frontmatter.get("location")) frontmatter.set("location", input.positionLabel.trim() || input.location.trim());
		});
		const sourceContent = updateFrontmatter(sourceOriginal, (frontmatter) => {
			frontmatter.set("extract_file", `[[${extract.relative.replace(/\.md$/, "")}]]`);
			if (frontmatter.get("status") === "captured") frontmatter.set("status", "extracted");
		});
		atomicWrite(extract.absolute, extractContent);
		atomicWrite(source.absolute, sourceContent);
		const validation = validateChangedFiles(root, [source.absolute, extract.absolute]);
		if (!validation.passed) throw new Error(`Reader Extract validation failed: ${JSON.stringify(validation.findings)}`);
		return { path: extract.relative, extractId: id, created, duplicate: false, validation };
	} catch (error) {
		atomicWrite(source.absolute, sourceOriginal);
		if (created) unlinkSync(extract.absolute);
		else atomicWrite(extract.absolute, extractOriginal);
		throw error;
	}
}
