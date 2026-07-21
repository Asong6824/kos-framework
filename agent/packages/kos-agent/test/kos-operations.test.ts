import { copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { createObject } from "../src/kos/operations/create-object.ts";
import { transitionStatus } from "../src/kos/operations/transition-status.ts";
import { processSource } from "../src/kos/operations/process-source.ts";
import { updateProject } from "../src/kos/operations/update-project.ts";
import { generateDailyBrief, generateDailyDashboard, generateDiary } from "../src/kos/operations/daily-workflows.ts";

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
	for (const name of [
		"Project_项目模板.md", "Concept_原子概念模板.md", "Method_方法模板.md", "Task_任务模板.md",
		"Source_输入源模板.md", "Extract_摘录模板.md", "Summary_摘要模板.md", "Research_研究报告模板.md",
		"Reflection_认知记录模板.md", "PersonalOperatingProfile_个人操作画像模板.md", "Signal_信息雷达模板.md",
		"TopicWatch_主题监控模板.md", "CompanyWatch_公司监控模板.md",
	]) {
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

	it("previews object creation without writing", () => {
		const root = vault();
		const result = createObject(root, { kind: "concept", title: "Preview", directories, dryRun: true });
		expect(result).toMatchObject({ path: "22_知识库/Preview.md", validation: { passed: true } });
		expect(existsSync(join(root, result.path))).toBe(false);
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

	it("creates the migrated research, reflection, watch and processing object types", () => {
		const root = vault();
		const research = createObject(root, {
			kind: "research",
			title: "Harness Engineering",
			directories,
			extra: { question: "Harness 应该负责什么？", area: "[[系统]]", category: "系统" },
		});
		expect(research.path).toBe("21_研究/系统/Harness Engineering.md");
		expect(research.validation.passed).toBe(true);

		const reflection = createObject(root, { kind: "reflection", title: "今天的判断", directories });
		expect(reflection.path).toBe("24_认知记录/今天的判断_反思.md");

		const topic = createObject(root, { kind: "topic_watch", title: "Agent", directories });
		expect(topic.path).toBe("50_信息雷达/主题监控/Agent.md");

		const company = createObject(root, { kind: "company_watch", title: "Example", directories });
		expect(readFileSync(join(root, company.path), "utf8")).toContain('company: "Example"');

		const extract = createObject(root, {
			kind: "extract",
			title: "Paper",
			directories,
			extra: { source: "[[11_原材料/论文/Paper]]" },
		});
		expect(extract.path).toBe("20_处理区/摘录/Paper_摘录.md");
	});

	it("atomically creates Source processing objects and maintains backlinks", () => {
		const root = vault();
		const source = createObject(root, { kind: "source", title: "Article", directories });
		const result = processSource(root, { kind: "summary", query: source.path, directories });
		expect(result.path).toBe("20_处理区/摘要/Article_摘要.md");
		const updated = readFileSync(join(root, source.path), "utf8");
		expect(updated).toContain("status: summarized");
		expect(updated).toContain("[[20_处理区/摘要/Article_摘要]]");
	});

	it("updates Project sections and rolls the result through validation", () => {
		const root = vault();
		const project = createObject(root, { kind: "project", title: "Migrate", directories });
		const result = updateProject(root, {
			query: project.path,
			status: "active",
			currentStage: "Harness migration",
			progress: ["完成 TypeScript validator"],
			tasks: ["删除旧 Python"],
		});
		expect(result.validation.passed).toBe(true);
		const content = readFileSync(join(root, project.path), "utf8");
		expect(content).toContain("status: active");
		expect(content).toContain("完成 TypeScript validator");
		expect(content).toContain("- [ ] 删除旧 Python");
	});

	it("generates daily artifacts and preserves manual blocks", () => {
		const root = vault();
		createObject(root, { kind: "project", title: "Daily", directories });
		const now = new Date(2026, 6, 20, 9, 30, 0);
		const dashboard = generateDailyDashboard(root, now);
		expect(dashboard).toMatchObject({ path: "00_工作台/今日工作台.md", validation: { passed: true } });
		const dashboardPath = join(root, dashboard.path);
		const edited = readFileSync(dashboardPath, "utf8").replace("- 今日主线：", "- 今日主线：迁移 Harness");
		writeFileSync(dashboardPath, edited);
		generateDailyDashboard(root, new Date(2026, 6, 20, 10, 0, 0));
		expect(readFileSync(dashboardPath, "utf8")).toContain("今日主线：迁移 Harness");

		const brief = generateDailyBrief(root, now);
		expect(brief).toMatchObject({ path: "50_信息雷达/每日简报/2026-07-20.md", validation: { passed: true } });
		const diary = generateDiary(root, now);
		expect(diary).toMatchObject({ path: "23_日记/2026/07/2026-07-20.md", validation: { passed: true } });
	});
});
