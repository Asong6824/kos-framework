import { copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { createObject } from "../src/kos/operations/create-object.ts";
import { transitionStatus } from "../src/kos/operations/transition-status.ts";

const repoRoot = resolve(import.meta.dirname, "../../../..");
const roots: string[] = [];
const directories = {
	project: "30_项目",
	concept: "22_知识库",
	method: "40_方法库",
	task: "31_任务",
	source: "11_原材料",
};

function vault(): string {
	const root = mkdtempSync(join(tmpdir(), "kos-operations-"));
	roots.push(root);
	writeFileSync(join(root, ".kos.md"), "# kos\n");
	mkdirSync(join(root, "90_系统/模板"), { recursive: true });
	for (const name of ["Project_项目模板.md", "Concept_原子概念模板.md", "Method_方法模板.md", "Task_任务模板.md", "Source_输入源模板.md"]) {
		copyFileSync(join(repoRoot, "vault/90_系统/模板", name), join(root, "90_系统/模板", name));
	}
	return root;
}

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("kos deterministic operations", () => {
	it("creates a validated concept from the Vault template without overwriting", () => {
		const root = vault();
		const result = createObject(root, { kind: "concept", title: "Agent / Harness", directories });
		expect(result.path).toBe("22_知识库/Agent Harness.md");
		expect(result.validation.passed).toBe(true);
		const content = readFileSync(join(root, result.path), "utf8");
		expect(content).toContain('title: "Agent Harness"');
		expect(content).toContain("# Agent Harness");
		expect(() => createObject(root, { kind: "concept", title: "Agent / Harness", directories })).toThrow(/already exists/);
	});

	it("creates source format directories and rejects paths outside the Vault", () => {
		const root = vault();
		const result = createObject(root, {
			kind: "source",
			title: "Paper",
			directories,
			extra: { format: "paper" },
		});
		expect(result.path).toBe("11_原材料/论文/Paper.md");
		expect(existsSync(join(root, result.path))).toBe(true);
		expect(() => createObject(root, { kind: "concept", title: "Escape", directories: { ...directories, concept: "../outside" } })).toThrow(/escapes/);
	});

	it("applies legal YOLO transitions and rejects illegal transitions", () => {
		const root = vault();
		const created = createObject(root, { kind: "concept", title: "Lifecycle", directories });
		const transitioned = transitionStatus(root, { path: created.path, target: "verified" });
		expect(transitioned).toMatchObject({ type: "concept", from: "draft", to: "verified" });
		expect(readFileSync(join(root, created.path), "utf8")).toContain("status: verified");
		expect(() => transitionStatus(root, { path: created.path, target: "draft" })).toThrow(/Illegal/);
	});

	it("keeps deterministic evidence requirements and task completion bookkeeping", () => {
		const root = vault();
		const method = createObject(root, { kind: "method", title: "Method", directories });
		expect(() => transitionStatus(root, { path: method.path, target: "usable" })).toThrow(/validated_times >= 1/);

		const task = createObject(root, { kind: "task", title: "Task", directories });
		transitionStatus(root, { path: task.path, target: "doing" });
		transitionStatus(root, { path: task.path, target: "done" });
		expect(readFileSync(join(root, task.path), "utf8")).toMatch(/completed: "?\d{4}-\d{2}-\d{2}"?/);
	});
});
