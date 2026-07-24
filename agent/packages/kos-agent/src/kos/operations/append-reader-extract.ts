import { createHash } from "node:crypto";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { parseDocument } from "yaml";
import { parseFrontmatterFile } from "../validation/frontmatter.ts";
import { validateChangedFiles } from "../validation/validate.ts";
import { createObject, sanitizeFileName } from "./create-object.ts";
import { atomicWrite, resolveInsideRoot } from "./files.ts";
import type {
	AppendReaderExtractInput,
	AppendReaderExtractResult,
	DeleteReaderAnnotationInput,
	DeleteReaderAnnotationResult,
	ListReaderAnnotationsInput,
	ListReaderAnnotationsResult,
	ReaderAnchor,
	ReaderAnnotation,
	ReaderAnnotationColor,
} from "./types.ts";

const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/;
const MAX_SELECTION_LENGTH = 20_000;
const MAX_NOTE_LENGTH = 2_000;
const ANNOTATION_COLORS = new Set<ReaderAnnotationColor>(["yellow", "red", "blue", "green"]);

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

function normalizeNote(note: string | undefined): string {
	return String(note ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_NOTE_LENGTH);
}

function annotationColor(color: unknown): ReaderAnnotationColor {
	return ANNOTATION_COLORS.has(color as ReaderAnnotationColor) ? color as ReaderAnnotationColor : "yellow";
}

function defaultAnchor(input: AppendReaderExtractInput, text: string): ReaderAnchor {
	if (input.kind === "pdf") {
		return { format: "pdf", page: Number.parseInt(input.location.replace(/^page:/, ""), 10) || 1, rects: [], quote: text };
	}
	if (input.kind === "epub") return { format: "epub", cfiRange: input.location, quote: text };
	return { format: "markdown", quote: text };
}

function normalizeAnchor(input: AppendReaderExtractInput, text: string): ReaderAnchor {
	if (input.kind === "pdf" && input.anchor?.format === "pdf") {
		const page = Number.parseInt(input.location.replace(/^page:/, ""), 10) || input.anchor.page || 1;
		const rects = input.anchor.rects.filter((rect) => [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)).map((rect) => ({
			x: Math.max(0, Math.min(1, rect.x)),
			y: Math.max(0, Math.min(1, rect.y)),
			width: Math.max(0, Math.min(1, rect.width)),
			height: Math.max(0, Math.min(1, rect.height)),
		}));
		return { format: "pdf", page, rects, quote: text };
	}
	if (input.kind === "epub" && input.anchor?.format === "epub") return { format: "epub", cfiRange: input.location, quote: text };
	if (input.kind === "markdown" && input.anchor?.format === "markdown") return { ...input.anchor, quote: text };
	return defaultAnchor(input, text);
}

function commentJson(value: unknown): string {
	return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/--/g, "\\u002d\\u002d");
}

function extractBlock(annotation: ReaderAnnotation): string {
	const note = annotation.note ? [`- 批注：${annotation.note}`] : [];
	return [
		`<!-- kos-reader-extract:start ${annotation.id} -->`,
		quote(annotation.text),
		"",
		`- 位置：${annotation.positionLabel || annotation.location}`,
		`- 原文件：${documentLink(annotation.documentPath)}`,
		...note,
		`^${annotation.id}`,
		`<!-- kos-reader: ${commentJson({ version: 1, ...annotation })} -->`,
		`<!-- kos-reader-extract:end ${annotation.id} -->`,
	].join("\n");
}

function parseAnnotations(content: string, extractPath: string): ReaderAnnotation[] {
	const annotations: ReaderAnnotation[] = [];
	const pattern = /<!-- kos-reader-extract:start ([a-zA-Z0-9_-]+) -->[\s\S]*?<!-- kos-reader:\s*(\{[^\n]*\})\s*-->[\s\S]*?<!-- kos-reader-extract:end \1 -->/g;
	for (const match of content.matchAll(pattern)) {
		try {
			const value = JSON.parse(match[2]) as Partial<ReaderAnnotation> & { version?: number };
			if (value.version !== 1 || value.id !== match[1] || !value.anchor || !value.text) continue;
			annotations.push({
				id: value.id,
				sourcePath: String(value.sourcePath ?? ""),
				documentPath: String(value.documentPath ?? ""),
				extractPath,
				kind: value.kind === "pdf" || value.kind === "epub" ? value.kind : "markdown",
				location: String(value.location ?? ""),
				positionLabel: String(value.positionLabel ?? ""),
				text: String(value.text),
				note: String(value.note ?? ""),
				color: annotationColor(value.color),
				anchor: value.anchor,
				createdAt: String(value.createdAt ?? ""),
				updatedAt: String(value.updatedAt ?? value.createdAt ?? ""),
			});
		} catch {
			// A damaged metadata comment is ignored; the human-readable quote remains intact.
		}
	}
	return annotations;
}

function exactBlockPattern(id: string): RegExp {
	const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return new RegExp(`(?:\\n{0,2})<!-- kos-reader-extract:start ${escaped} -->[\\s\\S]*?<!-- kos-reader-extract:end ${escaped} -->(?:\\n{0,2})`);
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
		const annotation = parseAnnotations(extractOriginal, extract.relative).find((item) => item.id === id);
		if (!annotation) throw new Error(`Reader annotation metadata is missing or damaged: ${id}`);
		return {
			path: extract.relative,
			extractId: id,
			created: false,
			duplicate: true,
			annotation,
			validation: validateChangedFiles(root, [source.absolute, extract.absolute]),
		};
	}
	const now = new Date().toISOString();
	const annotation: ReaderAnnotation = {
		id,
		sourcePath: source.relative,
		documentPath: document.relative,
		extractPath: extract.relative,
		kind: input.kind,
		location: input.location.trim(),
		positionLabel: input.positionLabel.trim(),
		text,
		note: normalizeNote(input.note),
		color: annotationColor(input.color),
		anchor: normalizeAnchor(input, text),
		createdAt: now,
		updatedAt: now,
	};

	try {
		let extractContent = appendToExtract(extractOriginal, extractBlock(annotation));
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
		return { path: extract.relative, extractId: id, created, duplicate: false, annotation, validation };
	} catch (error) {
		atomicWrite(source.absolute, sourceOriginal);
		if (created) unlinkSync(extract.absolute);
		else atomicWrite(extract.absolute, extractOriginal);
		throw error;
	}
}

export function listReaderAnnotations(root: string, input: ListReaderAnnotationsInput): ListReaderAnnotationsResult {
	const source = resolveInsideRoot(root, input.sourcePath);
	if (!existsSync(source.absolute)) throw new Error(`Source does not exist: ${source.relative}`);
	const parsed = parseFrontmatterFile(source.absolute);
	if (parsed.frontmatter?.type !== "source") throw new Error(`Target is not a Source: ${source.relative}`);
	const extractPath = associatedExtract(root, source.relative, parsed.frontmatter.extract_file);
	if (!extractPath) return { extractPath: null, annotations: [] };
	const extract = resolveInsideRoot(root, extractPath);
	return { extractPath: extract.relative, annotations: parseAnnotations(readFileSync(extract.absolute, "utf8"), extract.relative) };
}

export function deleteReaderAnnotation(root: string, input: DeleteReaderAnnotationInput): DeleteReaderAnnotationResult {
	const listed = listReaderAnnotations(root, { sourcePath: input.sourcePath });
	if (!listed.extractPath) throw new Error(`Source has no Reader Extract: ${input.sourcePath}`);
	if (!listed.annotations.some((item) => item.id === input.extractId)) throw new Error(`Unknown Reader annotation: ${input.extractId}`);
	const extract = resolveInsideRoot(root, listed.extractPath);
	const original = readFileSync(extract.absolute, "utf8");
	const updated = original.replace(exactBlockPattern(input.extractId), "\n\n");
	if (updated === original) throw new Error(`Reader annotation block is missing: ${input.extractId}`);
	try {
		atomicWrite(extract.absolute, updated.replace(/\n{4,}/g, "\n\n\n"));
		const validation = validateChangedFiles(root, [extract.absolute]);
		if (!validation.passed) throw new Error(`Reader annotation deletion failed validation: ${JSON.stringify(validation.findings)}`);
		return { path: extract.relative, extractId: input.extractId, deleted: true, validation };
	} catch (error) {
		atomicWrite(extract.absolute, original);
		throw error;
	}
}
