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
	goal: { template: "Goal_半年目标模板.md", placeholder: "目标名", directory: "goal", defaultDirectory: "30_目标" },
	project: { template: "Project_项目模板.md", placeholder: "项目名", directory: "project", defaultDirectory: "31_项目" },
	concept: { template: "Concept_原子概念模板.md", placeholder: "概念名", directory: "concept", defaultDirectory: "22_知识库" },
	method: { template: "Method_方法模板.md", placeholder: "方法名", directory: "method", defaultDirectory: "23_方法库" },
	task: { template: "Task_任务模板.md", placeholder: "任务名", directory: "task", defaultDirectory: "32_任务" },
	source: { template: "Source_输入源模板.md", placeholder: "标题", directory: "source", defaultDirectory: "11_原材料" },
	extract: { template: "Extract_摘录模板.md", placeholder: "来源标题", directory: "extract", defaultDirectory: "20_处理区/摘录", fileSuffix: "_摘录" },
	summary: { template: "Summary_摘要模板.md", placeholder: "来源标题", directory: "summary", defaultDirectory: "20_处理区/摘要", fileSuffix: "_摘要" },
	research: { template: "Research_研究报告模板.md", placeholder: "研究主题", directory: "research", defaultDirectory: "21_研究" },
	reflection: { template: "Reflection_认知记录模板.md", placeholder: "反思主题", directory: "reflection", defaultDirectory: "41_认知记录", fileSuffix: "_反思" },
	personal_operating_profile: { template: "PersonalOperatingProfile_个人操作画像模板.md", placeholder: "个人操作画像", directory: "personal_operating_profile", defaultDirectory: "42_个人操作画像" },
	signal: { template: "Signal_信息雷达模板.md", placeholder: "每日信息雷达 YYYY-MM-DD", directory: "signal", defaultDirectory: "12_信息雷达/主题监控" },
	topic_watch: { template: "TopicWatch_主题监控模板.md", placeholder: "主题名", directory: "topic_watch", defaultDirectory: "12_信息雷达/主题监控" },
	company_watch: { template: "CompanyWatch_公司监控模板.md", placeholder: "公司名", directory: "company_watch", defaultDirectory: "12_信息雷达/公司监控" },
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

function currentPeriod(): string {
	const now = new Date();
	return `${now.getFullYear()}-${now.getMonth() < 6 ? "H1" : "H2"}`;
}

function goalPeriod(value: unknown): { period: string; horizon: "H1" | "H2"; start: string; end: string } {
	const period = scalar(value) ?? currentPeriod();
	const match = /^(\d{4})-(H1|H2)$/.exec(period);
	if (!match) throw new Error("Goal period must use YYYY-H1 or YYYY-H2");
	const [, year, horizon] = match;
	return {
		period,
		horizon: horizon as "H1" | "H2",
		start: `${year}-${horizon === "H1" ? "01-01" : "07-01"}`,
		end: `${year}-${horizon === "H1" ? "06-30" : "12-31"}`,
	};
}

function items(value: unknown): string[] {
	const values = Array.isArray(value) ? value : value === undefined ? [] : [value];
	return values.flatMap((item) => String(item).split(/[;\n]/)).map((item) => item.trim().replace(/^-\s*/, "")).filter(Boolean);
}

function scalar(value: unknown): string | undefined {
	return items(value).at(-1);
}

function replaceSection(body: string, heading: string, content: string): string {
	const headings = [...body.matchAll(/^(#{2,6})\s+(.+?)\s*$/gm)];
	const currentIndex = headings.findIndex((match) => match[2].trim() === heading);
	if (currentIndex < 0) return body;
	const current = headings[currentIndex];
	const level = current[1].length;
	const sectionStart = (current.index ?? 0) + current[0].length;
	const next = headings.slice(currentIndex + 1).find((match) => match[1].length <= level);
	const sectionEnd = next?.index ?? body.length;
	return `${body.slice(0, sectionStart)}\n\n${content.trim()}\n\n${body.slice(sectionEnd).replace(/^\n+/, "")}`;
}

function bullets(value: unknown): string {
	return items(value).map((item) => `- ${item}`).join("\n");
}

function checkboxes(value: unknown): string {
	return items(value).map((item) => `- [ ] ${item}`).join("\n");
}

function numbered(value: unknown): string {
	return items(value).map((item, index) => `${index + 1}. ${item}`).join("\n");
}

function renderBody(body: string, kind: CreateObjectKind, extra: CreateObjectInput["extra"]): string {
	const fields = extra ?? {};
	const mappings: Partial<Record<CreateObjectKind, Array<[string, string, (value: unknown) => string]>>> = {
		goal: [
			["why", "为什么重要", String], ["expected_result", "期望结果", String],
			["metric", "量化指标", bullets], ["not_doing", "不做什么", bullets], ["constraint", "约束与代价", bullets],
		],
		project: [
			["why", "背景与策略假设", String], ["alignment_reason", "与当前目标的关系", String],
			["process_metric", "过程指标", bullets], ["result_metric", "结果指标", bullets],
			["current_stage", "当前阶段与下一里程碑", String], ["problem", "阻塞与风险", bullets],
		],
		concept: [
			["definition", "定义", String], ["problem", "解决什么问题", String], ["importance", "为什么重要", String],
			["understanding", "我的理解", String], ["source", "来源与参考", bullets], ["scenario", "应用场景", bullets],
		],
		method: [
			["problem", "方法解决什么问题", String], ["scenario", "适用场景", bullets], ["not_scenario", "不适用场景", bullets],
			["prerequisite", "前置条件", bullets], ["step", "执行步骤", numbered], ["criteria", "判断标准", bullets],
			["pitfall", "常见坑", bullets], ["validation", "验证方式", bullets],
		],
		research: [
			["question", "研究问题", String], ["goal", "研究目标", String], ["background", "背景", String],
			["concept_candidate", "候选 Concept", bullets],
		],
		reflection: [
			["trigger", "触发背景", String], ["previous_view", "我原来怎么想", String], ["changed_view", "现在的变化", String],
			["reason", "为什么发生变化", String], ["impact", "这个变化可能影响什么", String], ["to_verify", "后续要验证什么", bullets],
		],
		personal_operating_profile: [
			["conclusion", "当前可用结论", bullets], ["evidence", "支持证据", bullets], ["applies_to", "适用场景", bullets],
			["not_applies_to", "不适用场景", bullets], ["collaboration_preference", "协作偏好", bullets],
			["high_energy_task", "高能量任务", bullets], ["low_energy_task", "低能量任务", bullets],
			["blind_spot", "决策盲区", bullets], ["agent_guideline", "Agent 应如何使用", bullets],
			["hypothesis", "仍需验证的假设", bullets], ["rejected_belief", "已被推翻的旧判断", bullets],
		],
		topic_watch: [
			["why", "为什么关注这个主题", String], ["question", "核心问题", bullets], ["keyword", "关键词", bullets],
			["source", "主要信息源", bullets], ["next", "下一步关注", bullets],
		],
		company_watch: [
			["why", "为什么关注这家公司", String], ["business", "核心业务", bullets], ["metric", "关键跟踪指标", bullets],
			["question", "需要进一步研究的问题", bullets],
		],
		signal: [
			["fact", "今日重要变化", bullets], ["interpretation", "可能影响我判断的信息", bullets],
			["impact", "需要进一步研究的问题", bullets],
		],
	};
	let result = body;
	for (const [field, heading, format] of mappings[kind] ?? []) {
		if (fields[field] !== undefined) result = replaceSection(result, heading, format(fields[field]));
	}
	if (kind === "method" && (fields.source_project !== undefined || fields.source_reflection !== undefined)) {
		result = replaceSection(result, "相关案例", bullets([...items(fields.source_project), ...items(fields.source_reflection)]));
	}
	if (kind === "research" && (fields.related !== undefined || fields.related_source !== undefined)) {
		result = replaceSection(result, "资料来源", bullets([...items(fields.related), ...items(fields.related_source)]));
	}
	return result;
}

function applyFrontmatter(document: ReturnType<typeof parseDocument>, kind: CreateObjectKind, extra: CreateObjectInput["extra"]): void {
	const fields = extra ?? {};
	const scalarFields: Partial<Record<CreateObjectKind, Record<string, string>>> = {
		goal: { health: "health" },
		project: {
			status: "status", category: "category", priority: "priority", area: "area", primary_goal: "primary_goal",
			goal_alignment: "goal_alignment", alignment_reviewed: "alignment_reviewed", exploration_review_due: "exploration_review_due",
			current_stage: "current_stage", next_milestone: "next_milestone", due: "due",
		},
		concept: { area: "area", source: "source" },
		research: { question: "question", area: "area" },
		reflection: { source_diary: "source_diary", trigger: "trigger" },
		source: { format: "format", source_url: "source_url", source_location: "source_location", importance: "importance" },
		extract: { source: "source", extracted_by: "extracted_by", location: "location" },
		summary: { source: "source", generated_by: "generated_by" },
		signal: { signal_type: "signal_type", source_name: "source_name", source_url: "source_url", importance: "importance", confidence: "confidence", requires_research: "requires_research" },
		company_watch: { ticker: "ticker", market: "market" },
		task: {
			status: "status", priority: "priority", scheduled_for: "scheduled_for", defer_until: "defer_until", due: "due",
			estimate_minutes: "estimate_minutes", energy: "energy", work_mode: "work_mode", growth_mode: "growth_mode",
		},
	};
	const listFields: Partial<Record<CreateObjectKind, Record<string, string>>> = {
		goal: { result_evidence: "result_evidence", tag: "tags" },
		project: {
			supporting_goal: "supporting_goals", process_metric: "process_metrics", result_metric: "result_metrics",
			related_source: "related_sources", related_research: "related_research", related_concept: "related_concepts",
			related_method: "related_methods", tag: "tags",
		},
		concept: { alias: "aliases", related_source: "related_sources", related_research: "related_research", related_project: "related_projects", related_concept: "related_concepts", tag: "tags" },
		method: { scenario: "applicable_scenarios", source_project: "related_projects", related_concept: "related_concepts", tag: "tags" },
		research: { related: "related_sources", related_source: "related_sources", related_project: "related_projects", related_concept: "related_concepts", tag: "tags" },
		reflection: { related_project: "related_projects", tag: "tags" },
		personal_operating_profile: { source: "sources", related_reflection: "related_reflections", related_method: "related_methods", related_project: "related_projects", applies_to_skill: "applies_to_skills", tag: "tags" },
		signal: { source: "sources", topic: "related_topics", related_project: "related_projects", tag: "tags" },
		topic_watch: { keyword: "keywords", source: "tracked_sources", related_project: "related_projects", related_research: "related_research", tag: "tags" },
		company_watch: { related_topic: "related_topics", related_project: "related_projects", related_research: "related_research", tag: "tags" },
		task: { project: "projects", projects: "projects", scheduled_time: "scheduled_times", tag: "tags" },
	};
	for (const [input, output] of Object.entries(scalarFields[kind] ?? {})) {
		const value = scalar(fields[input]);
		if (value !== undefined) document.set(output, value === "true" ? true : value === "false" ? false : value);
	}
	for (const [input, output] of Object.entries(listFields[kind] ?? {})) {
		if (fields[input] !== undefined) document.set(output, items(fields[input]));
	}
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
	if (input.kind === "goal") {
		const goal = goalPeriod(input.extra?.period);
		document.set("period", goal.period);
		document.set("horizon", goal.horizon);
		document.set("period_start", goal.start);
		document.set("period_end", goal.end);
		const weight = Number(input.extra?.allocation_weight ?? 0);
		if (!Number.isInteger(weight) || weight < 0 || weight > 100) throw new Error("Goal allocation_weight must be an integer from 0 to 100");
		document.set("allocation_weight", weight);
	}
	for (const field of ["created", "updated", "date"]) {
		if (document.has(field)) document.set(field, today);
	}
	applyFrontmatter(document, input.kind, input.extra);
	if (input.kind === "project") {
		document.set("process_metrics", metricObjects(items(input.extra?.process_metric), "process", today));
		document.set("result_metrics", metricObjects(items(input.extra?.result_metric), "result", today));
	}
	if (input.kind === "task" && input.extra?.estimate_minutes !== undefined) {
		const estimate = Number(input.extra.estimate_minutes);
		if (!Number.isInteger(estimate) || estimate < 1) throw new Error("Task estimate_minutes must be a positive integer");
		document.set("estimate_minutes", estimate);
	}
	if (input.kind === "source") document.set("format", input.extra?.format ?? "article");
	let body = template.slice(match[0].length).split(spec.placeholder).join(title).split("YYYY-MM-DD").join(today);
	body = renderBody(body, input.kind, input.extra);
	if (input.kind === "signal") body = body.replace(/^# .*$/m, `# ${title}`);
	return `---\n${document.toString().trim()}\n---\n${body}`;
}

function metricObjects(values: string[], kind: "process" | "result", updated: string): Array<Record<string, unknown>> {
	return values.map((value, index) => {
		const [rawId, rawName, rawTarget, rawUnit] = value.split("|").map((item) => item.trim());
		const parsedTarget = Number(rawTarget ?? "");
		const idBase = rawId.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-|-$/g, "") || `${kind}-${index + 1}`;
		return {
			id: idBase, kind, name: rawName || rawId, unit: rawUnit || "count", baseline: 0,
			target: Number.isFinite(parsedTarget) ? parsedTarget : 1, current: 0, updated, evidence: [],
		};
	});
}

export function createObject(root: string, input: CreateObjectInput): OperationResult {
	const spec = SPECS[input.kind];
	const title = sanitizeFileName(input.title);
	if (!title) throw new Error("Object title is empty after filename sanitization");
	let baseDirectory = input.directories[spec.directory] ?? spec.defaultDirectory;
	if (input.kind === "goal") baseDirectory = `${baseDirectory}/${goalPeriod(input.extra?.period).period}`;
	const format = input.extra?.format ?? "article";
	if (input.kind === "source") baseDirectory = `${baseDirectory}/${FORMAT_DIRS[String(format)] ?? String(format)}`;
	if (["research", "reflection", "personal_operating_profile"].includes(input.kind) && input.extra?.category) {
		baseDirectory = `${baseDirectory}/${sanitizeFileName(String(input.extra.category))}`;
	}
	const datePrefix = input.kind === "signal" ? `${localDate()}_` : "";
	const fileName = `${datePrefix}${title}${spec.fileSuffix ?? ""}.md`;
	const relativeTarget = input.kind === "project"
		? `${baseDirectory}/${title}/${title}.md`
		: `${baseDirectory}/${fileName}`;
	const target = resolveInsideRoot(root, relativeTarget);
	if (input.kind === "project") {
		const processMetrics = items(input.extra?.process_metric);
		const resultMetrics = items(input.extra?.result_metric);
		if (processMetrics.length + resultMetrics.length === 0) {
			throw new Error("Project requires at least one quantitative process_metric or result_metric");
		}
	}
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
