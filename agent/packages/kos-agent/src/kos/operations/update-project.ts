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
	let updated = `---\n${document.toString().trim()}\n---\n${original.slice(match[0].length)}`;
	updated = appendLines(updated, "进展", input.progress?.map((item) => `- ${today}：${item}`));
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

function findProject(root: string, query?: string): string {
	const base = resolve(root, "30_项目");
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
