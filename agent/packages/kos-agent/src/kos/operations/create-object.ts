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
	defaultDirectory: string;
	fileSuffix?: string;
	headingTitle?: string;
}

const SPECS: Readonly<Record<CreateObjectKind, CreateSpec>> = {
	project: { template: "Project_项目模板.md", placeholder: "项目名", directory: "project", defaultDirectory: "30_项目" },
	concept: { template: "Concept_原子概念模板.md", placeholder: "概念名", directory: "concept", defaultDirectory: "22_知识库" },
	method: { template: "Method_方法模板.md", placeholder: "方法名", directory: "method", defaultDirectory: "40_方法库" },
	task: { template: "Task_任务模板.md", placeholder: "任务名", directory: "task", defaultDirectory: "31_任务" },
	source: { template: "Source_输入源模板.md", placeholder: "标题", directory: "source", defaultDirectory: "11_原材料" },
	extract: { template: "Extract_摘录模板.md", placeholder: "来源标题", directory: "extract", defaultDirectory: "20_处理区/摘录", fileSuffix: "_摘录" },
	summary: { template: "Summary_摘要模板.md", placeholder: "来源标题", directory: "summary", defaultDirectory: "20_处理区/摘要", fileSuffix: "_摘要" },
	research: { template: "Research_研究报告模板.md", placeholder: "研究主题", directory: "research", defaultDirectory: "21_研究" },
	reflection: { template: "Reflection_认知记录模板.md", placeholder: "反思主题", directory: "reflection", defaultDirectory: "24_认知记录", fileSuffix: "_反思" },
	personal_operating_profile: { template: "PersonalOperatingProfile_个人操作画像模板.md", placeholder: "个人操作画像", directory: "personal_operating_profile", defaultDirectory: "25_个人操作画像" },
	signal: { template: "Signal_信息雷达模板.md", placeholder: "每日信息雷达 YYYY-MM-DD", directory: "signal", defaultDirectory: "50_信息雷达/主题监控" },
	topic_watch: { template: "TopicWatch_主题监控模板.md", placeholder: "主题名", directory: "topic_watch", defaultDirectory: "50_信息雷达/主题监控" },
	company_watch: { template: "CompanyWatch_公司监控模板.md", placeholder: "公司名", directory: "company_watch", defaultDirectory: "50_信息雷达/公司监控" },
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
	if (input.kind === "company_watch") {
		document.set("company", title);
		document.set("title", `公司监控：${title}`);
	}
	if (input.kind === "research") document.set("question", String(input.extra?.question ?? title));
	for (const field of ["created", "updated", "date"]) {
		if (document.has(field)) document.set(field, today);
	}
	if (input.kind === "project") {
		if (input.extra?.goal !== undefined) document.set("goal", input.extra.goal);
		if (input.extra?.priority !== undefined) document.set("priority", input.extra.priority);
	}
	if (input.kind === "source") document.set("format", input.extra?.format ?? "article");
	for (const [field, value] of Object.entries(input.extra ?? {})) {
		if (value !== undefined && field !== "format") document.set(field, value);
	}
	if (input.kind === "source") document.set("format", input.extra?.format ?? "article");
	let body = template.slice(match[0].length).split(spec.placeholder).join(title).split("YYYY-MM-DD").join(today);
	if (input.kind === "signal") body = body.replace(/^# .*$/m, `# ${title}`);
	return `---\n${document.toString().trim()}\n---\n${body}`;
}

export function createObject(root: string, input: CreateObjectInput): OperationResult {
	const spec = SPECS[input.kind];
	const title = sanitizeFileName(input.title);
	if (!title) throw new Error("Object title is empty after filename sanitization");
	let baseDirectory = input.directories[spec.directory] ?? spec.defaultDirectory;
	const format = input.extra?.format ?? "article";
	if (input.kind === "source") baseDirectory = `${baseDirectory}/${FORMAT_DIRS[String(format)] ?? String(format)}`;
	if (["research", "reflection", "personal_operating_profile"].includes(input.kind) && input.extra?.category) {
		baseDirectory = `${baseDirectory}/${sanitizeFileName(String(input.extra.category))}`;
	}
	const datePrefix = input.kind === "signal" ? `${localDate()}_` : "";
	const target = resolveInsideRoot(root, `${baseDirectory}/${datePrefix}${title}${spec.fileSuffix ?? ""}.md`);
	if (existsSync(target.absolute)) throw new Error(`Object already exists: ${target.relative}`);
	const templatePath = resolveInsideRoot(root, `90_系统/模板/${spec.template}`);
	if (!existsSync(templatePath.absolute)) throw new Error(`Required template is missing: ${templatePath.relative}`);
	const content = renderTemplate(readFileSync(templatePath.absolute, "utf8"), spec, title, input);
	if (input.dryRun) {
		return {
			path: target.relative,
			validation: { root: resolve(root), validatedPaths: [target.relative], findings: [], errorCount: 0, warningCount: 0, passed: true },
		};
	}
	mkdirSync(dirname(target.absolute), { recursive: true });
	atomicWrite(target.absolute, content);
	const validation = validateChangedFiles(root, [target.absolute]);
	if (!validation.passed) {
		unlinkSync(target.absolute);
		throw new Error(`Created object failed validation and was rolled back: ${JSON.stringify(validation.findings)}`);
	}
	return { path: target.relative, validation };
}
