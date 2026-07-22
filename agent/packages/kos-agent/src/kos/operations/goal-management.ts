import { readFileSync } from "node:fs";
import { parseDocument } from "yaml";
import { validateChangedFiles } from "../validation/validate.ts";
import { atomicWrite, resolveInsideRoot } from "./files.ts";
import type { GoalHealthReview, OperationResult, UpdateGoalInput } from "./types.ts";

const FRONTMATTER = /^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/;

function stringList(value: unknown): string[] {
	const resolved = value && typeof value === "object" && "toJSON" in value && typeof value.toJSON === "function" ? value.toJSON() : value;
	return Array.isArray(resolved) ? resolved.map(String) : [];
}

function section(markdown: string, heading: string, lines: string[]): string {
	const replacement = `## ${heading}\n\n${lines.length ? lines.map((item) => `- ${item}`).join("\n") : "- "}`;
	const match = new RegExp(`^## ${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "m").exec(markdown);
	if (!match) return `${markdown.trimEnd()}\n\n${replacement}\n`;
	const rest = markdown.slice((match.index ?? 0) + match[0].length);
	const next = /^## /m.exec(rest);
	const end = next ? (match.index ?? 0) + match[0].length + (next.index ?? 0) : markdown.length;
	return `${markdown.slice(0, match.index)}${replacement}\n\n${markdown.slice(end).replace(/^\s*/, "")}`;
}

function appendSection(markdown: string, heading: string, lines: string[]): string {
	if (!lines.length) return markdown;
	const match = new RegExp(`^## ${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "m").exec(markdown);
	const additions = lines.map((item) => `- ${new Date().toISOString().slice(0, 10)}：${item}`).join("\n");
	if (!match) return `${markdown.trimEnd()}\n\n## ${heading}\n\n${additions}\n`;
	const start = (match.index ?? 0) + match[0].length;
	return `${markdown.slice(0, start)}\n\n${additions}${markdown.slice(start)}`;
}

export function updateGoal(root: string, input: UpdateGoalInput): OperationResult {
	const target = resolveInsideRoot(root, input.path);
	const original = readFileSync(target.absolute, "utf8");
	const match = FRONTMATTER.exec(original);
	if (!match) throw new Error(`Goal has no frontmatter: ${target.relative}`);
	const document = parseDocument(match[1]);
	if (document.errors.length || document.get("type") !== "goal") throw new Error(`Object is not a valid Goal: ${target.relative}`);
	if (document.get("status") === "active" && (input.expectedResults !== undefined || input.metrics !== undefined) && !input.humanConfirmed) {
		throw new Error("Changing an active Goal result definition or metrics requires human confirmation");
	}
	if (input.title !== undefined) {
		if (!input.title.trim()) throw new Error("Goal title cannot be empty");
		document.set("title", input.title.trim());
	}
	if (input.health !== undefined) document.set("health", input.health);
	document.set("updated", new Date().toISOString().slice(0, 10));
	if (input.humanConfirmed) document.set("human_confirmed", true);
	const existingEvidence = stringList(document.get("result_evidence"));
	const evidenceToAppend = (input.appendEvidence ?? [])
		.map((item) => item.trim())
		.filter((item) => item.length > 0 && !existingEvidence.includes(item));
	if (evidenceToAppend.length) document.set("result_evidence", [...existingEvidence, ...evidenceToAppend]);
	let updated = `---\n${document.toString().trim()}\n---\n${original.slice(match[0].length)}`;
	if (input.expectedResults !== undefined) updated = section(updated, "期望结果", input.expectedResults);
	if (input.metrics !== undefined) updated = section(updated, "量化指标", input.metrics);
	if (input.notDoing !== undefined) updated = section(updated, "不做什么", input.notDoing);
	if (input.constraints !== undefined) updated = section(updated, "约束与代价", input.constraints);
	updated = appendSection(updated, "进展证据", evidenceToAppend);
	atomicWrite(target.absolute, updated);
	const validation = validateChangedFiles(root, [target.absolute]);
	if (!validation.passed) { atomicWrite(target.absolute, original); throw new Error(`Goal update failed validation and was rolled back: ${JSON.stringify(validation.findings)}`); }
	return { path: target.relative, validation };
}

export function reviewGoalHealth(root: string, path: string, date = new Date().toISOString().slice(0, 10)): GoalHealthReview {
	const target = resolveInsideRoot(root, path);
	const original = readFileSync(target.absolute, "utf8");
	const match = FRONTMATTER.exec(original);
	if (!match) throw new Error(`Goal has no frontmatter: ${target.relative}`);
	const document = parseDocument(match[1]);
	if (document.get("type") !== "goal") throw new Error(`Object is not a Goal: ${target.relative}`);
	const evidence = stringList(document.get("result_evidence"));
	const end = String(document.get("period_end") ?? "");
	const reasons: string[] = [];
	let suggested: GoalHealthReview["suggested"] = "unknown";
	if (document.get("status") !== "active") reasons.push("Goal 当前不是 active，不评估推进健康度");
	else if (end && date > end && evidence.length === 0) { suggested = "off_track"; reasons.push("周期已结束且没有结果证据"); }
	else if (evidence.length > 0) { suggested = "on_track"; reasons.push("存在可追溯结果证据"); }
	else { suggested = "at_risk"; reasons.push("当前没有结果证据，需要结合 Project 指标人工判断"); }
	return { path: target.relative, current: String(document.get("health") ?? "unknown"), suggested, reasons, evidenceCount: evidence.length, requiresConfirmation: true };
}
