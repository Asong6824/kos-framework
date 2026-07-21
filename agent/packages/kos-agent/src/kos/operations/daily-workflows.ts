import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { stringify } from "yaml";
import { parseFrontmatterFile } from "../validation/frontmatter.ts";
import { validateChangedFiles } from "../validation/validate.ts";
import { atomicWrite, resolveInsideRoot } from "./files.ts";
import type { OperationResult } from "./types.ts";

interface RecordItem {
	path: string;
	fm: Record<string, unknown>;
	body: string;
}

const MANUAL_BLOCK_RE = /<!-- 人手动添加 -->[\s\S]*?<!-- \/人手动添加 -->/g;

export function generateDailyDashboard(root: string, now = new Date()): OperationResult {
	const date = localDate(now);
	const records = objectRecords(root);
	const by = (type: string, statuses: string[]): string[] => records
		.filter((item) => item.fm.type === type && statuses.includes(String(item.fm.status ?? "")))
		.map((item) => `${link(item)} — ${String(item.fm.status ?? "")}`);
	const active = by("project", ["active"]);
	const ideas = by("project", ["idea"]);
	const blocked = by("project", ["blocked"]);
	const paused = by("project", ["paused"]);
	const captured = by("source", ["captured"]);
	const review = records.filter(needsReview).map((item) => `${link(item)} — 待审核`);
	const tasks = records.filter((item) => item.fm.type === "task" && ["todo", "doing", "blocked"].includes(String(item.fm.status)))
		.map((item) => `${link(item)} — ${String(item.fm.status)}`);
	const signals = records.filter((item) => item.fm.type === "signal" && (
		String(item.fm.date ?? item.fm.created ?? "") === date || ["high", "critical"].includes(String(item.fm.importance ?? ""))
	)).map((item) => `${link(item)} — ${String(item.fm.importance ?? "signal")}`);
	const questions = records.filter((item) => item.fm.type === "signal" && item.fm.requires_research === true).map(link);
	const inbox = markdownFiles(resolve(root, "10_收件箱")).map((path) => `[[${relative(root, path).replace(/\.md$/, "")}]]`);
	const content = `---
type: dashboard
dashboard_type: daily
date: ${date}
created: ${date}
auto_generated: true
last_updated: "${localTimestamp(now)}"
tags: [dashboard]
---
# 今日工作台 - ${date}

## 1. 今日状态

<!-- 人手动添加 -->

- 精力状态：
- 今日主线：
- 今天最重要的一件事：

<!-- /人手动添加 -->

### 今日主线候选

${items(active.map((item) => `${item} — 明确今天的下一步行动`))}

## 2. 当前项目

### Active 项目

${items(active)}

### Idea 项目

${items(ideas)}

### Blocked 项目

${items(blocked)}

### Paused 项目

${items(paused)}

## 3. 待处理输入源

### 收件箱

${items(inbox)}

### 待摘录

${items(captured)}

### 待摘要

${items(captured)}

### 待审核

${items(review)}

## 4. 今日任务

${checkboxes(tasks)}

## 5. 信息雷达摘要

### 今日重要变化

${items(signals)}

### 需要进一步研究的问题

${items(questions)}

## 6. 今日思考

<!-- 人手动添加 -->

### 重要想法


### 判断变化


### 新问题


<!-- /人手动添加 -->

## 7. 日终回顾

<!-- 人手动添加 -->

### 今天推进了什么


### 今天学到了什么


### 明天继续


<!-- /人手动添加 -->

## 8. AI 建议

${items(review.length ? ["存在待审核产物，审阅后再进入 verified 状态。"] : ["选择一个明确的下一步行动。"])}
`;
	return writeGenerated(root, "00_工作台/今日工作台.md", content);
}

export function generateDailyBrief(root: string, now = new Date()): OperationResult {
	const date = localDate(now);
	const signals = objectRecords(root).filter((item) => item.fm.type === "signal" && item.fm.signal_type !== "daily_brief" && (
		String(item.fm.date ?? item.fm.event_date ?? item.fm.created ?? "") === date ||
		["high", "critical"].includes(String(item.fm.importance ?? "")) || item.fm.requires_research === true
	));
	const important = signals.filter((item) => ["high", "critical"].includes(String(item.fm.importance))).map(link);
	const questions = signals.filter((item) => item.fm.requires_research === true).map(link);
	const sources = [...new Set(signals.flatMap((item) => Array.isArray(item.fm.sources) ? item.fm.sources.map(String) : []))];
	const fm = {
		type: "signal", signal_type: "daily_brief", date, created: date, sources,
		importance: important.length ? "high" : "medium", requires_research: questions.length > 0,
		tags: ["radar", "daily_brief"],
	};
	const content = `---\n${stringify(fm).trim()}\n---
# 每日信息雷达 ${date}

## 今日重要变化

${items(important)}

## 关注主题更新

${items(signals.filter((item) => ["news", "research", "social", "other"].includes(String(item.fm.signal_type))).map(link))}

## 关注公司更新

${items(signals.filter((item) => item.fm.signal_type === "earnings" || Array.isArray(item.fm.related_companies)).map(link))}

## 宏观与政策变化

${items(signals.filter((item) => ["policy", "market", "macro"].includes(String(item.fm.signal_type))).map(link))}

## 技术趋势变化

${items(signals.filter((item) => item.fm.signal_type === "product").map(link))}

## 需要进一步研究的问题

${items(questions)}

## 我的确认与批注

<!-- 人手动添加 -->

<!-- /人手动添加 -->
`;
	return writeGenerated(root, `50_信息雷达/每日简报/${date}.md`, content);
}

export function generateDiary(root: string, now = new Date()): OperationResult {
	const date = localDate(now);
	const dashboardPath = resolve(root, "00_工作台/今日工作台.md");
	const dashboard = existsSync(dashboardPath) ? readFileSync(dashboardPath, "utf8") : "";
	const activeProjects = objectRecords(root).filter((item) => item.fm.type === "project" && item.fm.status === "active").map(link);
	const fm = {
		type: "diary", created: date, date,
		day_of_week: now.toLocaleDateString("en-US", { weekday: "long" }),
		week_number: isoWeek(now), mood: "", energy: 3, tags: ["daily"],
	};
	const manual = (heading: string) => `## ${heading}\n\n<!-- 人手动添加 -->\n\n- \n\n<!-- /人手动添加 -->`;
	const content = `---\n${stringify(fm).trim()}\n---
# ${date}

${manual("今日主线")}

${manual("今天推进了什么")}

${manual("今天学习了什么")}

${manual("今天产生的重要想法")}

${manual("判断变化")}

${manual("遇到的问题")}

## 项目相关记录

${items(activeProjects)}

## 今日任务快照

${section(dashboard, "今日任务") || "- [ ] 暂无"}

## 待审核内容

${section(dashboard, "待审核") || "- 暂无"}

${manual("明天继续")}

${manual("可提炼为认知记录的内容")}

## 来源

- [[00_工作台/今日工作台]]
`;
	return writeGenerated(root, `23_日记/${date.slice(0, 4)}/${date.slice(5, 7)}/${date}.md`, content);
}

function writeGenerated(root: string, path: string, content: string): OperationResult {
	const target = resolveInsideRoot(root, path);
	const original = existsSync(target.absolute) ? readFileSync(target.absolute, "utf8") : undefined;
	const final = preserveManual(original, content);
	mkdirSync(dirname(target.absolute), { recursive: true });
	atomicWrite(target.absolute, final);
	const validation = validateChangedFiles(root, [target.absolute]);
	if (!validation.passed) {
		if (original === undefined) unlinkSync(target.absolute);
		else atomicWrite(target.absolute, original);
		throw new Error(`Generated workflow failed validation and was rolled back: ${JSON.stringify(validation.findings)}`);
	}
	return { path: target.relative, validation };
}

function objectRecords(root: string): RecordItem[] {
	return ["11_原材料", "20_处理区", "21_研究", "22_知识库", "24_认知记录", "30_项目", "31_任务", "40_方法库", "50_信息雷达"]
		.flatMap((directory) => markdownFiles(resolve(root, directory)))
		.map((path) => {
			const parsed = parseFrontmatterFile(path);
			return { path: relative(root, path), fm: parsed.frontmatter ?? {}, body: parsed.body };
		});
}

function needsReview(item: RecordItem): boolean {
	return (item.fm.type === "summary" && item.fm.reviewed === false) ||
		new Set(["research:draft", "concept:draft", "reflection:raw", "method:candidate"])
			.has(`${String(item.fm.type)}:${String(item.fm.status)}`);
}

function markdownFiles(directory: string): string[] {
	if (!existsSync(directory)) return [];
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = resolve(directory, entry.name);
		return entry.isDirectory() ? markdownFiles(path) : entry.isFile() && path.endsWith(".md") ? [path] : [];
	}).sort();
}

function link(item: RecordItem): string {
	return `[[${item.path.replace(/\.md$/, "")}|${String(item.fm.title ?? item.path.split("/").at(-1)?.replace(/\.md$/, ""))}]]`;
}

function items(values: string[]): string { return values.length ? values.map((value) => `- ${value}`).join("\n") : "- 暂无"; }
function checkboxes(values: string[]): string { return values.length ? values.map((value) => `- [ ] ${value}`).join("\n") : "- [ ] 暂无"; }

function preserveManual(oldContent: string | undefined, next: string): string {
	if (!oldContent) return next;
	const blocks = oldContent.match(MANUAL_BLOCK_RE) ?? [];
	let index = 0;
	return next.replace(MANUAL_BLOCK_RE, (fallback) => blocks[index++] ?? fallback);
}

function section(markdown: string, heading: string): string {
	const headings = [...markdown.matchAll(/^(#{2,6})\s+(.+?)\s*$/gm)];
	const index = headings.findIndex((match) => match[2].trim() === heading);
	if (index < 0) return "";
	const current = headings[index];
	const next = headings.slice(index + 1).find((match) => match[1].length <= current[1].length);
	return markdown.slice((current.index ?? 0) + current[0].length, next?.index ?? markdown.length).trim();
}

function relative(root: string, path: string): string { return path.slice(resolve(root).length + 1).split("\\").join("/"); }
function localDate(now: Date): string { return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`; }
function localTimestamp(now: Date): string { return `${localDate(now)}T${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`; }
function isoWeek(date: Date): number {
	const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
	target.setUTCDate(target.getUTCDate() + 4 - (target.getUTCDay() || 7));
	const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
	return Math.ceil((((target.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
}
