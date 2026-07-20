import { existsSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseDocument } from "yaml";
import { validateChangedFiles } from "../validation/validate.ts";
import { atomicWrite, resolveInsideRoot } from "./files.ts";
import type { CreateObjectInput, CreateObjectKind, OperationResult } from "./types.ts";

interface CreateSpec {
	template: string;
	placeholder: string;
	directory: keyof CreateObjectInput["directories"];
}

const SPECS: Readonly<Record<CreateObjectKind, CreateSpec>> = {
	project: { template: "Project_项目模板.md", placeholder: "项目名", directory: "project" },
	concept: { template: "Concept_原子概念模板.md", placeholder: "概念名", directory: "concept" },
	method: { template: "Method_方法模板.md", placeholder: "方法名", directory: "method" },
	task: { template: "Task_任务模板.md", placeholder: "任务名", directory: "task" },
	source: { template: "Source_输入源模板.md", placeholder: "标题", directory: "source" },
};

const FORMAT_DIRS: Readonly<Record<string, string>> = {
	book: "书籍",
	paper: "论文",
	article: "文章",
	video: "视频",
	audio: "音频",
	podcast: "播客",
	report: "研报",
	news: "新闻",
	x_post: "帖子",
	course: "课程",
};

export function sanitizeFileName(name: string): string {
	return name.replace(/[\\/:*?"<>|#^[\]]/g, " ").replace(/\s+/g, " ").trim();
}

function localDate(): string {
	const now = new Date();
	const year = now.getFullYear();
	const month = String(now.getMonth() + 1).padStart(2, "0");
	const day = String(now.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

function renderTemplate(template: string, spec: CreateSpec, title: string, input: CreateObjectInput): string {
	const match = /^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/.exec(template);
	if (!match) throw new Error(`Template ${spec.template} has no frontmatter`);
	const document = parseDocument(match[1]);
	if (document.errors.length) throw new Error(`Template ${spec.template} frontmatter is invalid: ${document.errors[0].message}`);
	const today = localDate();
	document.set("title", title);
	for (const field of ["created", "updated", "date"]) {
		if (document.has(field)) document.set(field, today);
	}
	if (input.kind === "project") {
		if (input.extra?.goal !== undefined) document.set("goal", input.extra.goal);
		if (input.extra?.priority !== undefined) document.set("priority", input.extra.priority);
	}
	if (input.kind === "source") document.set("format", input.extra?.format ?? "article");
	const body = template.slice(match[0].length).split(spec.placeholder).join(title).split("YYYY-MM-DD").join(today);
	return `---\n${document.toString().trim()}\n---\n${body}`;
}

export function createObject(root: string, input: CreateObjectInput): OperationResult {
	const spec = SPECS[input.kind];
	const title = sanitizeFileName(input.title);
	if (!title) throw new Error("Object title is empty after filename sanitization");
	const baseDirectory = input.directories[spec.directory];
	if (!baseDirectory) throw new Error(`Missing directory mapping for ${spec.directory}`);
	const format = input.extra?.format ?? "article";
	const directory = input.kind === "source" ? `${baseDirectory}/${FORMAT_DIRS[format] ?? format}` : baseDirectory;
	const target = resolveInsideRoot(root, `${directory}/${title}.md`);
	if (existsSync(target.absolute)) throw new Error(`Object already exists: ${target.relative}`);
	const templatePath = resolveInsideRoot(root, `90_系统/模板/${spec.template}`);
	if (!existsSync(templatePath.absolute)) throw new Error(`Required template is missing: ${templatePath.relative}`);
	const content = renderTemplate(readFileSync(templatePath.absolute, "utf8"), spec, title, input);
	mkdirSync(dirname(target.absolute), { recursive: true });
	atomicWrite(target.absolute, content);
	const validation = validateChangedFiles(root, [target.absolute]);
	if (!validation.passed) {
		unlinkSync(target.absolute);
		throw new Error(`Created object failed validation and was rolled back: ${JSON.stringify(validation.findings)}`);
	}
	return { path: target.relative, validation };
}
