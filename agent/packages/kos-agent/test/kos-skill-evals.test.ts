import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { loadSkillEvalCases, runSkillEvals } from "../src/kos/evals/skill-evals.ts";

const roots: string[] = [];

function vault(): string {
	const root = mkdtempSync(join(tmpdir(), "kos-skill-eval-"));
	roots.push(root);
	mkdirSync(join(root, "80_Skills/core/example/config"), { recursive: true });
	mkdirSync(join(root, "90_系统/evals/skills"), { recursive: true });
	writeFileSync(
		join(root, "80_Skills/core/example/SKILL.md"),
		`---
name: example
metadata:
  hermes:
    pinned: true
  kos:
    scope: core
    external_systems: []
---
## When to Use
## Prerequisites
## How to Run
## Quick Reference
## Procedure
## Pitfalls
## Verification
Task Contract pass@1 pass@k 最大迭代 evals/contracts
`,
	);
	writeFileSync(join(root, "80_Skills/core/example/config/EXTEND.md"), "config\n");
	writeFileSync(
		join(root, "90_系统/evals/skills/example.prompts.csv"),
		"id,skill,should_trigger,prompt,expected_checks,notes\n" +
			"positive,example,true,run example,skill_exists|metadata_scope_core|core_pinned|has_required_sections|preserves_extend_config,core contract\n",
	);
	return root;
}

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("kos Skill Eval runtime", () => {
	it("loads a named suite and executes deterministic checkers", () => {
		const root = vault();
		expect(loadSkillEvalCases(root, "example")).toHaveLength(1);
		const result = runSkillEvals(root, { suite: "example", now: new Date(2026, 6, 20) });
		expect(result).toMatchObject({
			created: "2026-07-20",
			status: "pass",
			overall_pass: true,
			score: 100,
			case_count: 1,
			check_count: 5,
		});
	});

	it("reports unknown checkers instead of crashing", () => {
		const root = vault();
		writeFileSync(
			join(root, "90_系统/evals/skills/broken.prompts.csv"),
			"id,skill,should_trigger,prompt,expected_checks,notes\ncase,example,true,test,not_registered,\n",
		);
		const result = runSkillEvals(root, { suite: "broken" });
		expect(result).toMatchObject({ status: "fail", score: 0 });
		expect(result.results[0].checks[0].notes).toContain("未知检查器");
	});

	it("writes a schema-shaped artifact into the Vault data directory", () => {
		const root = vault();
		const result = runSkillEvals(root, { suite: "example", writeArtifact: true, now: new Date(2026, 6, 20) });
		expect(result.artifact).toBe(join(root, "90_系统/evals/artifacts/2026-07-20_example.json"));
		expect(existsSync(result.artifact!)).toBe(true);
		const artifact = JSON.parse(readFileSync(result.artifact!, "utf8")) as Record<string, unknown>;
		expect(artifact).not.toHaveProperty("artifact");
		expect(artifact).toMatchObject({ kind: "skill_contract_eval", status: "pass" });
	});

	it("returns no_cases for an empty runtime suite", () => {
		const result = runSkillEvals(vault(), { suite: "missing" });
		expect(result).toMatchObject({ status: "no_cases", overall_pass: false, score: 0, case_count: 0 });
	});
});
