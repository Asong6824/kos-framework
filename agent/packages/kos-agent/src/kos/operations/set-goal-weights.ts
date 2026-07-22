import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { parseDocument } from "yaml";
import { validateChangedFiles } from "../validation/validate.ts";
import { legalTargets } from "./state-machines.ts";
import { atomicWrite, resolveInsideRoot } from "./files.ts";
import type { SetGoalWeightsInput, SetGoalWeightsResult } from "./types.ts";

const FRONTMATTER = /^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/;

function localDate(): string {
	const now = new Date();
	return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function markdownFiles(directory: string): string[] {
	const files: string[] = [];
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		if ([".git", ".obsidian", "node_modules"].includes(entry.name)) continue;
		const path = resolve(directory, entry.name);
		if (entry.isDirectory()) files.push(...markdownFiles(path));
		else if (entry.isFile() && entry.name.endsWith(".md")) files.push(path);
	}
	return files;
}

function activeTotal(root: string, period: string): number {
	let total = 0;
	for (const path of markdownFiles(root)) {
		const match = FRONTMATTER.exec(readFileSync(path, "utf8"));
		if (!match) continue;
		const document = parseDocument(match[1]);
		if (document.errors.length) continue;
		if (document.get("type") === "goal" && document.get("period") === period && document.get("status") === "active") {
			total += Number(document.get("allocation_weight") ?? 0);
		}
	}
	return total;
}

export function setGoalWeights(root: string, input: SetGoalWeightsInput): SetGoalWeightsResult {
	if (!/^(\d{4})-(H1|H2)$/.test(input.period)) throw new Error("Goal period must use YYYY-H1 or YYYY-H2");
	if (input.humanConfirmed !== true) throw new Error("Goal allocation changes require explicit human confirmation");
	if (!input.changes.length) throw new Error("Goal allocation changes cannot be empty");
	const uniquePaths = new Set(input.changes.map((change) => change.path));
	if (uniquePaths.size !== input.changes.length) throw new Error("Goal allocation changes contain duplicate paths");

	const originals = new Map<string, string>();
	const rendered = new Map<string, string>();
	for (const change of input.changes) {
		const target = resolveInsideRoot(root, change.path);
		const original = readFileSync(target.absolute, "utf8");
		const match = FRONTMATTER.exec(original);
		if (!match) throw new Error(`Goal has no frontmatter: ${target.relative}`);
		const document = parseDocument(match[1]);
		if (document.errors.length) throw new Error(`Goal frontmatter is invalid: ${target.relative}`);
		if (document.get("type") !== "goal") throw new Error(`Object is not a Goal: ${target.relative}`);
		if (document.get("period") !== input.period) throw new Error(`Goal is not in ${input.period}: ${target.relative}`);
		if (change.allocationWeight !== undefined) {
			if (!Number.isInteger(change.allocationWeight) || change.allocationWeight < 0 || change.allocationWeight > 100) {
				throw new Error(`Goal allocation_weight must be an integer from 0 to 100: ${target.relative}`);
			}
			document.set("allocation_weight", change.allocationWeight);
		}
		if (change.targetStatus !== undefined) {
			const current = String(document.get("status") ?? "");
			if (!legalTargets("goal", current).includes(change.targetStatus)) {
				throw new Error(`Illegal goal transition: ${current} -> ${change.targetStatus}`);
			}
			if (change.targetStatus === "achieved") {
				const evidence = document.get("result_evidence");
				if (!Array.isArray(evidence) || evidence.length === 0) {
					throw new Error(`Goal -> achieved requires result_evidence: ${target.relative}`);
				}
			}
			document.set("status", change.targetStatus);
		}
		document.set("human_confirmed", true);
		document.set("updated", localDate());
		originals.set(target.absolute, original);
		rendered.set(target.absolute, `---\n${document.toString().trim()}\n---\n${original.slice(match[0].length)}`);
	}

	try {
		for (const [path, content] of rendered) atomicWrite(path, content);
		const changedPaths = [...rendered.keys()];
		const validation = validateChangedFiles(root, changedPaths);
		if (!validation.passed) throw new Error(`Goal allocation failed validation: ${JSON.stringify(validation.findings)}`);
		return { period: input.period, activeTotal: activeTotal(root, input.period), changedPaths: validation.validatedPaths, validation };
	} catch (error) {
		for (const [path, content] of originals) atomicWrite(path, content);
		throw error;
	}
}
