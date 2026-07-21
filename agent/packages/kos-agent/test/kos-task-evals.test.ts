import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
	TaskContractError,
	evaluateTaskContract,
	updateTaskRunState,
	type TaskContract,
	type TaskSelfAssessment,
} from "../src/kos/evals/task-contract.ts";
import { validateTaskContract } from "../src/kos/validation/skill-evals.ts";

const roots: string[] = [];

function vault(): string {
	const root = mkdtempSync(join(tmpdir(), "kos-task-eval-"));
	roots.push(root);
	writeFileSync(join(root, ".kos.md"), "# test\n");
	mkdirSync(join(root, "30_项目"));
	return root;
}

function contract(): TaskContract {
	return {
		version: 1,
		id: "project-created",
		skill: "kos-create-project",
		objective: "创建结构完整的 Project",
		max_iterations: 3,
		checks: [
			{ id: "project_exists", type: "path_exists", path: "30_项目/测试项目.md" },
			{
				id: "project_status",
				type: "frontmatter",
				path: "30_项目/测试项目.md",
				field: "status",
				operator: "equals",
				expected: "idea",
			},
			{
				id: "has_success_section",
				type: "text_contains",
				path: "30_项目/测试项目.md",
				values: ["### 成功指标"],
			},
		],
		rubric: [
			{ id: "actionability", description: "下一步行动具体且可执行", min_score: 3, weight: 1 },
		],
	};
}

function assessment(withEvidence = true): TaskSelfAssessment {
	return {
		contract_id: "project-created",
		summary: "项目对象满足任务合同",
		next_action: "",
		rubric: {
			actionability: {
				score: 4,
				evidence: withEvidence ? ["30_项目/测试项目.md#成功指标"] : [],
			},
		},
	};
}

function writeProject(root: string): void {
	writeFileSync(
		join(root, "30_项目/测试项目.md"),
		"---\ntype: project\nstatus: idea\n---\n\n### 成功指标\n\n- 可以验收\n",
	);
}

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("kos task completion evals", () => {
	it("rejects Vault escapes and unknown contract fields", () => {
		const escaped = contract() as unknown as Record<string, unknown>;
		(escaped.checks as Array<Record<string, unknown>>)[0].path = "../outside.md";
		expect(validateTaskContract(escaped).some((error) => error.includes("vault"))).toBe(true);

		const unknown = { ...contract(), success_message: "looks good" } as unknown as Record<string, unknown>;
		expect(validateTaskContract(unknown).some((error) => error.includes("未知顶层字段"))).toBe(true);
	});

	it("passes deterministic checks and an evidence-backed rubric", () => {
		const root = vault();
		writeProject(root);
		const attempt = evaluateTaskContract(root, contract(), assessment());
		expect(attempt).toMatchObject({ pass: true, deterministic_score: 100, semantic_score: 100 });
	});

	it("fails semantic criteria without evidence", () => {
		const root = vault();
		writeProject(root);
		const attempt = evaluateTaskContract(root, contract(), assessment(false));
		expect(attempt.pass).toBe(false);
		expect(attempt.failures).toContain("actionability");
	});

	it("accumulates attempts and records pass@1/pass@k", () => {
		const root = vault();
		const definition = contract();
		const first = evaluateTaskContract(root, definition, assessment(), 1);
		let state = updateTaskRunState(undefined, definition, first, "run-1");
		expect(state).toMatchObject({ status: "retryable", metrics: { pass_at_1: false, pass_at_k: false, iterations: 1 } });

		writeProject(root);
		const second = evaluateTaskContract(root, definition, assessment(), 2);
		state = updateTaskRunState(state, definition, second, "run-1");
		expect(state).toMatchObject({ status: "pass", metrics: { pass_at_1: false, pass_at_k: true, iterations: 2 } });
		expect(state.attempts).toHaveLength(2);
	});

	it("rejects contract mutation between iterations", () => {
		const root = vault();
		const definition = contract();
		const first = evaluateTaskContract(root, definition, assessment(), 1);
		const state = updateTaskRunState(undefined, definition, first, "run-1");
		definition.checks = [definition.checks[0]];
		const second = evaluateTaskContract(root, definition, assessment(), 2);
		expect(() => updateTaskRunState(state, definition, second, "run-1")).toThrow(TaskContractError);
	});

	it("exhausts at the iteration limit and pauses for the user", () => {
		const root = vault();
		const exhaustedDefinition = { ...contract(), max_iterations: 1 };
		const exhaustedAttempt = evaluateTaskContract(root, exhaustedDefinition, assessment(), 1);
		expect(updateTaskRunState(undefined, exhaustedDefinition, exhaustedAttempt, "run-exhausted").status).toBe("exhausted");

		const needsUserAssessment = { ...assessment(), needs_user: true };
		const needsUserAttempt = evaluateTaskContract(root, contract(), needsUserAssessment, 1);
		expect(updateTaskRunState(undefined, contract(), needsUserAttempt, "run-needs-user").status).toBe("needs_user");
	});
});
