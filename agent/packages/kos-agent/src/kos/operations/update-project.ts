import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { parseDocument } from "yaml";
import { parseFrontmatterFile } from "../validation/frontmatter.ts";
import { validateChangedFiles } from "../validation/validate.ts";
import { atomicWrite, resolveInsideRoot } from "./files.ts";
import type { OperationResult } from "./types.ts";

export interface UpdateProjectInput {
	query?: string;
	status?: string;
	currentStage?: string;
	progress?: string[];
	tasks?: string[];
	decisions?: string[];
	reviews?: string[];
	problems?: string[];
	finalResults?: string[];
	finalInsights?: string[];
	primaryGoal?: string;
	supportingGoals?: string[];
	goalAlignment?: "direct" | "enabling" | "exploratory" | "off_goal" | "conflicting";
	alignmentReviewed?: string;
	explorationReviewDue?: string;
	nextMilestone?: string;
	due?: string;
	metrics?: ProjectMetric[];
	metricUpdates?: Array<{ id: string; current: number; evidence: string }>;
	offGoalOverride?: boolean;
	overrideReason?: string;
	overrideReviewDue?: string;
	validationCompleted?: boolean;
	expectedResultAchieved?: boolean;
}

export interface ProjectMetric {
	id: string;
	kind: "process" | "result";
	name: string;
	unit: string;
	baseline: number;
	target: number;
	current: number;
	updated: string;
	evidence: string[];
}

export function updateProject(root: string, input: UpdateProjectInput): OperationResult {
	const path = findProject(root, input.query);
	const target = resolveInsideRoot(root, path);
	const original = readFileSync(target.absolute, "utf8");
	const match = /^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/.exec(original);
	if (!match) throw new Error(`Project has no frontmatter: ${target.relative}`);
	const document = parseDocument(match[1]);
	if (document.errors.length) throw new Error(`Project frontmatter is invalid: ${document.errors[0].message}`);
	if (document.get("type") !== "project") throw new Error(`Target is not a Project: ${target.relative}`);
	const today = localDate();
	document.set("updated", today);
	if (input.status) document.set("status", input.status);
	if (input.currentStage) document.set("current_stage", input.currentStage);
	if (input.primaryGoal !== undefined) document.set("primary_goal", input.primaryGoal);
	if (input.supportingGoals !== undefined) document.set("supporting_goals", input.supportingGoals);
	if (input.goalAlignment !== undefined) document.set("goal_alignment", input.goalAlignment);
	if (input.alignmentReviewed !== undefined) document.set("alignment_reviewed", input.alignmentReviewed);
	if (input.explorationReviewDue !== undefined) document.set("exploration_review_due", input.explorationReviewDue);
	if (input.nextMilestone !== undefined) document.set("next_milestone", input.nextMilestone);
	if (input.due !== undefined) document.set("due", input.due);
	if (input.metrics !== undefined) {
		if (!input.metrics.length) throw new Error("Project requires at least one quantitative metric");
		validateMetrics(input.metrics);
		document.set("process_metrics", input.metrics.filter((metric) => metric.kind === "process"));
		document.set("result_metrics", input.metrics.filter((metric) => metric.kind === "result"));
	}
	if (input.metricUpdates?.length) {
		const all = [...metricList(document.get("process_metrics")), ...metricList(document.get("result_metrics"))];
		for (const change of input.metricUpdates) {
			if (!change.evidence.trim()) throw new Error(`Metric ${change.id} update requires evidence`);
			const metric = all.find((item) => item.id === change.id);
			if (!metric) throw new Error(`Unknown Project metric: ${change.id}`);
			metric.current = change.current; metric.updated = today; metric.evidence = [...metric.evidence, `${today} | ${change.evidence.trim()}`];
		}
		document.set("process_metrics", all.filter((metric) => metric.kind === "process"));
		document.set("result_metrics", all.filter((metric) => metric.kind === "result"));
	}
	if (input.offGoalOverride !== undefined) document.set("off_goal_override", input.offGoalOverride);
	if (input.overrideReason !== undefined) document.set("override_reason", input.overrideReason);
	if (input.overrideReviewDue !== undefined) document.set("override_review_due", input.overrideReviewDue);
	if (input.offGoalOverride && (!input.overrideReason?.trim() || !input.overrideReviewDue?.trim())) throw new Error("Low-alignment Project override requires reason and review date");
	if (input.validationCompleted !== undefined) document.set("validation_completed", input.validationCompleted);
	if (input.expectedResultAchieved !== undefined) document.set("expected_result_achieved", input.expectedResultAchieved);
	if (input.status === "completed" && (input.validationCompleted === undefined || input.expectedResultAchieved === undefined)) {
		throw new Error("Completing a Project requires validationCompleted and expectedResultAchieved decisions");
	}
	let updated = `---\n${document.toString().trim()}\n---\n${original.slice(match[0].length)}`;
	updated = appendLines(updated, "进展证据", input.progress?.map((item) => `- ${today}：${item}`));
	updated = appendLines(updated, "进展证据", input.metricUpdates?.map((item) => `- ${today}：指标 \`${item.id}\` 更新为 ${item.current}；证据：${item.evidence}`));
	updated = appendLines(updated, "当前任务", input.tasks?.map((item) => `- [ ] ${item}`));
	updated = appendLines(updated, "当前问题", input.problems?.map((item) => `- ${item}`));
	updated = appendLines(updated, "阶段性复盘", input.reviews?.map((item) => `- ${today}：${item}`));
	updated = appendLines(updated, "最终成果", input.finalResults?.map((item) => `- ${today}：${item}`));
	updated = appendLines(updated, "最终沉淀", input.finalInsights?.map((item) => `- ${today}：${item}`));
	for (const decision of input.decisions ?? []) {
		updated = appendLines(updated, "决策日志", [
			`- ${today}：`, `  - 情境：${decision}`, "  - 选择：待补充。", "  - 理由：待补充。", "  - 风险：待补充。",
		]);
	}
	if (input.status) updated = appendLines(updated, "状态变更记录", [`- ${today}：状态更新为 \`${input.status}\`（YOLO）`]);
	atomicWrite(target.absolute, updated);
	const validation = validateChangedFiles(root, [target.absolute]);
	if (!validation.passed) {
		atomicWrite(target.absolute, original);
		throw new Error(`Project update failed validation and was rolled back: ${JSON.stringify(validation.findings)}`);
	}
	return { path: target.relative, validation };
}

function metricList(value: unknown): ProjectMetric[] {
	const resolved = value && typeof value === "object" && "toJSON" in value && typeof value.toJSON === "function" ? value.toJSON() : value;
	if (!Array.isArray(resolved)) return [];
	return resolved.filter((item): item is ProjectMetric => Boolean(item && typeof item === "object" && !Array.isArray(item) && "id" in item)).map((item) => ({ ...item, evidence: Array.isArray(item.evidence) ? item.evidence.map(String) : [] }));
}

function validateMetrics(metrics: ProjectMetric[]): void {
	const ids = new Set<string>();
	for (const metric of metrics) {
		if (!/^[a-z0-9][a-z0-9_-]*$/.test(metric.id)) throw new Error(`Metric id must be stable kebab/snake case: ${metric.id}`);
		if (ids.has(metric.id)) throw new Error(`Duplicate metric id: ${metric.id}`);
		if (!metric.name.trim() || !metric.unit.trim() || !Number.isFinite(metric.target) || !Number.isFinite(metric.current) || !Number.isFinite(metric.baseline)) throw new Error(`Metric ${metric.id} is incomplete`);
		ids.add(metric.id);
	}
}

function findProject(root: string, query?: string): string {
	const base = resolve(root, "31_项目");
	const projects = markdownFiles(base).filter((path) => parseFrontmatterFile(path).frontmatter?.type === "project");
	if (!projects.length) throw new Error("未找到 Project");
	if (!query) {
		const active = projects.filter((path) => parseFrontmatterFile(path).frontmatter?.status === "active");
		if (active.length === 1) return relative(root, active[0]);
		throw new Error("请提供项目路径或标题；当前无法唯一定位");
	}
	const direct = resolveInsideRoot(root, query);
	if (existsSync(direct.absolute)) return direct.relative;
	const matches = projects.filter((path) => {
		const fm = parseFrontmatterFile(path).frontmatter;
		return relative(root, path).includes(query) || String(fm?.title ?? "").includes(query);
	});
	if (matches.length !== 1) throw new Error(matches.length ? "匹配到多个 Project，请提供更精确路径" : `未找到匹配 Project：${query}`);
	return relative(root, matches[0]);
}

function markdownFiles(directory: string): string[] {
	if (!existsSync(directory)) return [];
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = resolve(directory, entry.name);
		return entry.isDirectory() ? markdownFiles(path) : entry.isFile() && path.endsWith(".md") ? [path] : [];
	}).sort();
}

function appendLines(markdown: string, heading: string, lines?: string[]): string {
	if (!lines?.length) return markdown;
	const headings = [...markdown.matchAll(/^(#{2,6})\s+(.+?)\s*$/gm)];
	const index = headings.findIndex((match) => match[2].trim() === heading);
	if (index < 0) return `${markdown.trimEnd()}\n\n## ${heading}\n\n${lines.join("\n")}\n`;
	const current = headings[index];
	const level = current[1].length;
	const next = headings.slice(index + 1).find((match) => match[1].length <= level);
	const insertAt = next?.index ?? markdown.length;
	return `${markdown.slice(0, insertAt).trimEnd()}\n\n${lines.join("\n")}\n\n${markdown.slice(insertAt).replace(/^\n+/, "")}`;
}

function relative(root: string, path: string): string {
	return path.slice(resolve(root).length + 1).split("\\").join("/");
}

function localDate(): string {
	const now = new Date();
	return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
