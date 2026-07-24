import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { ExtensionAPI, ToolResultEvent, ToolResultEventResult } from "../src/core/extensions/types.ts";
import kosValidationExtension from "../src/extensions/kos-validation.ts";
import { loadObjectSchemas } from "../src/kos/validation/schemas.ts";
import { REQUIRED_VAULT_DIRS, validateChangedFiles, validateVault } from "../src/kos/validation/validate.ts";
import { validateSkillEvals } from "../src/kos/validation/skill-evals.ts";
import { validateSkills } from "../src/kos/validation/skills.ts";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(packageDir, "../../..");
const tempDirs: string[] = [];

function tempVault(): string {
	const root = mkdtempSync(join(tmpdir(), "kos-validation-"));
	tempDirs.push(root);
	writeFileSync(join(root, ".kos.md"), "# kos\n");
	for (const directory of REQUIRED_VAULT_DIRS) mkdirSync(join(root, directory), { recursive: true });
	return root;
}

function writeObject(root: string, path: string, frontmatter: string): void {
	const target = join(root, path);
	mkdirSync(dirname(target), { recursive: true });
	writeFileSync(target, `---\n${frontmatter.trim()}\n---\n\nBody\n`);
}

afterEach(() => {
	for (const root of tempDirs.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("kos validation", () => {
	it("loads the migrated schema set and accepts a valid promoted concept without permission warnings", () => {
		expect(loadObjectSchemas().size).toBe(16);
		const root = tempVault();
		writeObject(
			root,
			"22_知识库/valid.md",
			`type: concept
title: Valid
status: verified
confidence: verified
area: systems
created: 2026-07-20
updated: 2026-07-20`,
		);

		const report = validateVault(root);
		expect(report.errorCount).toBe(0);
		expect(report.warningCount).toBe(0);
		expect(report.passed).toBe(true);
	});

	it("reports path, schema and state errors without model judgment", () => {
		const root = tempVault();
		writeObject(
			root,
			"22_知识库/wrong-source.md",
			`type: source
format: article
title: Wrong directory
created: 2026-07-20
status: captured`,
		);
		writeObject(
			root,
			"22_知识库/invalid-concept.md",
			`type: concept
status: impossible
confidence: draft
area: systems
created: 2026-07-20
updated: 2026-07-20`,
		);
		writeObject(
			root,
			"22_知识库/promoted.md",
			`type: concept
title: Promoted
status: mature
confidence: mature
area: systems
created: 2026-07-20
updated: 2026-07-20`,
		);

		const report = validateVault(root);
		const errorCounts = Object.fromEntries(
			["schema", "state"].map((name) => [
				name,
				report.findings.filter((item) => item.level === "ERROR" && item.validator === name).length,
			]),
		);
		const pathWarnings = report.findings.filter(
			(item) => item.level === "WARN" && item.validator === "paths",
		);
		expect(pathWarnings.length).toBeGreaterThan(0);
		expect(errorCounts.schema).toBeGreaterThan(0);
		expect(errorCounts.state).toBeGreaterThan(0);
		expect(report.warningCount).toBeGreaterThan(0);
		expect(report.passed).toBe(false);
	});

	it("validates only changed object files", () => {
		const root = tempVault();
		writeObject(root, "22_知识库/no-frontmatter.md", "type: concept");
		const report = validateChangedFiles(root, ["22_知识库/no-frontmatter.md", "90_系统/文档/ignored.md"]);
		expect(report.validatedPaths).toEqual(["22_知识库/no-frontmatter.md"]);
		expect(report.errorCount).toBeGreaterThan(0);
	});

	it("allows plain Markdown materials beside a canonical Project main file", () => {
		const root = tempVault();
		mkdirSync(join(root, "31_项目/Research"), { recursive: true });
		writeFileSync(join(root, "31_项目/Research/notes.md"), "# Research notes\n");
		const report = validateChangedFiles(root, ["31_项目/Research/notes.md"]);
		expect(report.findings).toEqual([]);
		expect(report.passed).toBe(true);
	});

	it("validates task objects instead of treating them as unknown types", () => {
		const root = tempVault();
		writeObject(root, "32_任务/invalid.md", "type: task\nstatus: todo");
		const report = validateChangedFiles(root, ["32_任务/invalid.md"]);
		expect(report.findings.some((finding) => finding.message.includes("暂无 schema"))).toBe(false);
		expect(report.findings.some((finding) => finding.message.includes("`title`"))).toBe(true);
		expect(report.passed).toBe(false);
	});

	it("validates Goal periods and active allocation totals across files", () => {
		const root = tempVault();
		for (const [name, weight] of [["one", 60], ["two", 30]] as const) {
			writeObject(root, `30_目标/2027-H1/${name}.md`, `type: goal
title: ${name}
horizon: H1
period: 2027-H1
status: active
allocation_weight: ${weight}
health: unknown
period_start: 2027-01-01
period_end: 2027-06-30
created: 2026-12-20
updated: 2026-12-20
human_confirmed: true
tags: [goal]`);
		}
		const report = validateVault(root);
		expect(report.findings).toContainEqual(expect.objectContaining({ validator: "business", level: "ERROR", path: "30_目标/2027-H1" }));
	});

	it("marks a successful write result as failed when deterministic validation fails", async () => {
		const root = tempVault();
		writeObject(root, "22_知识库/invalid.md", "type: concept");
		let handler: ((event: ToolResultEvent, context: unknown) => Promise<ToolResultEventResult | undefined>) | undefined;
		kosValidationExtension({
			on(event, callback) {
				if (event === "tool_result") handler = callback as typeof handler;
			},
		} as ExtensionAPI);
		expect(handler).toBeDefined();

		const result = await handler!(
			{
				type: "tool_result",
				toolCallId: "write-1",
				toolName: "write",
				input: { path: "22_知识库/invalid.md" },
				content: [{ type: "text", text: "written" }],
				details: undefined,
				isError: false,
			},
			{ cwd: root },
		);

		expect(result?.isError).toBe(true);
		expect(result?.details).toMatchObject({ validation: { passed: false } });
		expect(result?.content?.at(-1)).toMatchObject({ type: "text" });
	});

	it("matches the current Skill and Skill Eval distribution", () => {
		const root = join(repoRoot, "vault");
		const skills = validateSkills(root);
		const evals = validateSkillEvals(root);
		expect(skills).toMatchObject({ passed: true, errorCount: 0, warningCount: 0 });
		expect(skills.validatedPaths).toHaveLength(24);
		expect(evals).toMatchObject({ passed: true, errorCount: 0, warningCount: 0 });
	});

	it("rejects invalid Skill metadata and Eval definitions", () => {
		const root = tempVault();
		writeObject(
			root,
			"80_Skills/core/wrong-name/SKILL.md",
			`name: another-name
description: test
version: 1.0.0
metadata:
  kos:
    scope: personal
    lifecycle: active
    promoted: true
    review_required: false
    object_types: {}
    external_systems: none
  hermes:
    pinned: false`,
		);
		writeFileSync(
			join(root, "90_系统/evals/skills/invalid.prompts.csv"),
			"id,skill,should_trigger,prompt,expected_checks,notes\ncase-1,missing,maybe,,unknown_check,\n",
		);
		writeFileSync(
			join(root, "90_系统/evals/contracts/invalid.task.yaml"),
			"version: 2\nid: invalid\nskill: missing\nobjective: test\nchecks: []\n",
		);

		const skills = validateSkills(root);
		const evals = validateSkillEvals(root);
		expect(skills.errorCount).toBeGreaterThanOrEqual(3);
		expect(skills.warningCount).toBe(1);
		expect(evals.errorCount).toBeGreaterThanOrEqual(6);
	});
});
