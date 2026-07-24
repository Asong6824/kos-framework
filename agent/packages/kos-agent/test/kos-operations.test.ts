import { copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { createObject } from "../src/kos/operations/create-object.ts";
import { appendReaderExtract, deleteReaderAnnotation, listReaderAnnotations } from "../src/kos/operations/append-reader-extract.ts";
import { transitionStatus } from "../src/kos/operations/transition-status.ts";
import { setGoalWeights } from "../src/kos/operations/set-goal-weights.ts";
import { reviewGoalHealth, updateGoal } from "../src/kos/operations/goal-management.ts";
import { archiveTask, completeTask, deferTask, listTaskPool, returnTaskToPool, updateTask } from "../src/kos/operations/task-pool.ts";
import { buildPlanningContext, endDay, migrateTaskPool, recordRecommendationFeedback, reviewMonth, reviewWeek, saveDailyPlan, startDay } from "../src/kos/operations/progress-workflows.ts";
import { processSource } from "../src/kos/operations/process-source.ts";
import { updateProject } from "../src/kos/operations/update-project.ts";
import { generateDailyBrief, generateDailyDashboard, generateDiary } from "../src/kos/operations/daily-workflows.ts";
import { migrateLayout } from "../src/kos/operations/layout-migration.ts";
import { migrateProjectDirectories } from "../src/kos/operations/project-directories.ts";
import { allowedOptions, assertAllowed, parseValues } from "../src/kos-cli.ts";

const repoRoot = resolve(import.meta.dirname, "../../../..");
const roots: string[] = [];
const directories = {
	project: "31_项目",
	concept: "22_知识库",
	method: "23_方法库",
	task: "32_任务",
	source: "11_原材料",
};

function vault(): string {
	const root = mkdtempSync(join(tmpdir(), "kos-operations-"));
	roots.push(root);
	writeFileSync(join(root, ".kos.md"), "# kos\n");
	mkdirSync(join(root, "90_系统/模板"), { recursive: true });
	for (const name of [
		"Goal_半年目标模板.md", "Project_项目模板.md", "Concept_原子概念模板.md", "Method_方法模板.md", "Task_任务模板.md",
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

	it("preserves repeated CLI values and rejects unknown options", () => {
		const values = parseValues(["--kind", "project", "--task", "first", "--task", "second"]);
		expect(values.get("task")).toEqual(["first", "second"]);
		expect(() => assertAllowed(parseValues(["--topic", "AI", "--trigger", "new evidence"]), allowedOptions("create"))).not.toThrow();
		expect(() => assertAllowed(parseValues(["--format", "book", "--output-format", "json"]), allowedOptions("create"))).not.toThrow();
		expect(() => assertAllowed(parseValues(["--bogus", "value"]), allowedOptions("create"))).toThrow(/Unknown option: --bogus/);
	});

	it("renders documented project and profile creation fields", () => {
		const root = vault();
		const project = createObject(root, {
			kind: "project",
			title: "Documented Project",
			directories,
			extra: {
				status: "idea", category: "coding", priority: "P1", primary_goal: "[[30_目标/2027-H1/Ship it]]", why: "User need",
				current_stage: "Discovery", problem: ["Unknown scope"], process_metric: ["prototype | 每周原型次数 | 1"],
			},
		});
		const projectContent = readFileSync(join(root, project.path), "utf8");
		expect(projectContent).toContain('primary_goal: "[[30_目标/2027-H1/Ship it]]"');
		expect(projectContent).toContain("User need");
		expect(projectContent).toContain("prototype | 每周原型次数 | 1");

		const profile = createObject(root, {
			kind: "personal_operating_profile",
			title: "Working Style",
			directories,
			extra: { source: ["Assessment"], related_reflection: ["Retrospective"], conclusion: ["Prefer evidence"], evidence: ["Project history"] },
		});
		const profileContent = readFileSync(join(root, profile.path), "utf8");
		expect(profileContent).toContain("sources:\n  - Assessment");
		expect(profileContent).toContain("related_reflections:\n  - Retrospective");
		expect(profileContent).toContain("- Prefer evidence");
		expect(profileContent).toContain("- Project history");
	});

	it("allows known objects in personalized directories with a warning", () => {
		const root = vault();
		const result = createObject(root, {
			kind: "project",
			title: "Custom Layout",
			directories: { ...directories, project: "40_行动/41_项目" },
			extra: { result_metric: ["ship | 发布成果数 | 1"] },
		});
		expect(result.validation.passed).toBe(true);
		expect(result.validation.findings).toContainEqual(expect.objectContaining({ validator: "paths", level: "WARN" }));
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
		completeTask(root, { path: task.path, result: "Produced the expected output", contributions: [] });
		expect(readFileSync(join(root, task.path), "utf8")).toMatch(/completed: "?\d{4}-\d{2}-\d{2}"?/);
	});

	it("supports zero/multi-Project Tasks, deferral filtering and return to pool", () => {
		const root = vault();
		const loose = createObject(root, { kind: "task", title: "Loose task", directories });
		const shared = createObject(root, {
			kind: "task", title: "Shared research", directories,
			extra: { projects: ["[[31_项目/A]]", "[[31_项目/B]]"], estimate_minutes: 90, energy: "high", work_mode: "deep" },
		});
		expect(listTaskPool(root, "2027-01-01").available.map((task) => task.path)).toEqual(expect.arrayContaining([loose.path, shared.path]));
		deferTask(root, { path: shared.path, deferUntil: "2027-01-08", reason: "等待资料" });
		expect(listTaskPool(root, "2027-01-07").deferred.map((task) => task.path)).toContain(shared.path);
		expect(listTaskPool(root, "2027-01-08").available.map((task) => task.path)).toContain(shared.path);
		updateTask(root, { path: loose.path, scheduledFor: "2027-01-01", projects: [] });
		expect(listTaskPool(root, "2027-01-01").scheduled.map((task) => task.path)).toContain(loose.path);
		returnTaskToPool(root, { path: loose.path, reason: "今天容量不足" });
		expect(listTaskPool(root, "2027-01-01").available.map((task) => task.path)).toContain(loose.path);
	});

	it("migrates Project main files into canonical directories while preserving materials and references", () => {
		const root = vault();
		const flat = createObject(root, { kind: "project", title: "Flat", directories, extra: { result_metric: ["ship | Output | 1"] } });
		renameSync(join(root, flat.path), join(root, "31_项目/Flat.md"));
		const withMaterials = createObject(root, { kind: "project", title: "Research Knowledge", directories, extra: { process_metric: ["read | Papers | 3"] } });
		mkdirSync(join(root, "31_项目/Research"), { recursive: true });
		renameSync(join(root, withMaterials.path), join(root, "31_项目/Research/00_Research.md"));
		writeFileSync(join(root, "31_项目/Research/notes.md"), "# Notes\n");
		writeFileSync(join(root, "README.md"), "[[31_项目/Flat]] and [[31_项目/Research/00_Research]]\n");

		const preview = migrateProjectDirectories(root, true);
		expect(preview).toMatchObject({ dryRun: true, applied: false, scanned: 2, conflicts: [] });
		expect(preview.moves.filter((move) => move.state === "move")).toHaveLength(2);
		const result = migrateProjectDirectories(root);
		expect(result).toMatchObject({ applied: true, validation: { passed: true } });
		expect(existsSync(join(root, "31_项目/Flat/Flat.md"))).toBe(true);
		expect(existsSync(join(root, "31_项目/Research/Research.md"))).toBe(true);
		expect(existsSync(join(root, "31_项目/Research/notes.md"))).toBe(true);
		expect(readFileSync(join(root, "README.md"), "utf8")).toContain("[[31_项目/Flat/Flat]]");
		expect(readFileSync(join(root, "README.md"), "utf8")).toContain("[[31_项目/Research/Research]]");
		expect(migrateProjectDirectories(root).moves.every((move) => move.state === "already_canonical")).toBe(true);
	});

	it("recommends archiving completed linked Tasks and moves them only after confirmation", () => {
		const root = vault();
		const project = createObject(root, { kind: "project", title: "Archive Project", directories, extra: { result_metric: ["ship | Output | 1"] } });
		const task = createObject(root, { kind: "task", title: "Archive Task", directories, extra: { projects: [`[[${project.path.replace(/\.md$/, "")}]]`] } });
		const completed = completeTask(root, {
			path: task.path,
			result: "Shipped",
			contributions: [{ project: `[[${project.path.replace(/\.md$/, "")}]]`, level: "strong", evidence: "Delivered output" }],
		});
		expect(completed.archiveRecommended).toBe(true);
		expect(existsSync(join(root, task.path))).toBe(true);
		expect(listTaskPool(root).archiveCandidates.map((item) => item.path)).toContain(task.path);

		const archived = archiveTask(root, { path: task.path });
		expect(archived.path).toMatch(/^32_任务\/归档\/\d{4}\/Archive Task\.md$/);
		expect(existsSync(join(root, task.path))).toBe(false);
		expect(existsSync(join(root, archived.path))).toBe(true);
		expect(listTaskPool(root).archiveCandidates).toHaveLength(0);
		expect(readFileSync(join(root, project.path), "utf8")).toContain(`[[${archived.path.replace(/\.md$/, "")}]]`);
	});

	it("migrates legacy Tasks without claiming unverified Project progress", () => {
		const root = vault();
		mkdirSync(join(root, "32_任务"), { recursive: true });
		writeFileSync(join(root, "32_任务/Legacy.md"), `---\ntype: task\ntitle: Legacy\nstatus: done\nproject: "[[31_项目/A]]"\npriority: P2\ndue: ""\ncreated: 2026-01-01\ntags: []\n---\n# Legacy\n`);
		const result = migrateTaskPool(root);
		expect(result.changedPaths).toEqual(["32_任务/Legacy.md"]);
		const content = readFileSync(join(root, "32_任务/Legacy.md"), "utf8");
		expect(content).toContain("projects:");
		expect(content).not.toMatch(/^project:/m);
		expect(content).toContain("迁移前未记录贡献判断，待人工复核");
		expect(content).not.toContain("strong");
	});

	it("previews and applies the v1 to v2 layout without overwriting chained directories", () => {
		const root = vault();
		mkdirSync(join(root, "23_日记"), { recursive: true });
		mkdirSync(join(root, "30_项目"), { recursive: true });
		mkdirSync(join(root, "31_任务"), { recursive: true });
		mkdirSync(join(root, "41_Skills/core/example"), { recursive: true });
		writeFileSync(join(root, "23_日记/legacy.md"), "[[30_项目/Project]]\n");
		writeFileSync(join(root, "30_项目/Project.md"), "[[31_任务/Task]]\n");
		writeFileSync(join(root, "31_任务/Task.md"), "task\n");
		writeFileSync(join(root, "41_Skills/core/example/SKILL.md"), "skill\n");
		writeFileSync(join(root, "README.md"), "See [[23_日记/legacy]], [[30_项目/Project]], and [[41_Skills/core/example/SKILL]].\n");

		const preview = migrateLayout(root, true);
		expect(preview.applied).toBe(false);
		expect(preview.moves.find((move) => move.key === "goal")?.state).toBe("create");
		expect(preview.moves.find((move) => move.key === "project")?.state).toBe("move");
		expect(existsSync(join(root, "32_任务/Task.md"))).toBe(false);

		const applied = migrateLayout(root);
		expect(applied.applied).toBe(true);
		expect(applied.backupPath).toMatch(/^90_系统\/framework-backups\/.+-layout-v1$/);
		expect(readFileSync(join(root, "31_项目/Project.md"), "utf8")).toContain("[[32_任务/Task]]");
		expect(readFileSync(join(root, "README.md"), "utf8")).toContain("[[40_日记/legacy]]");
		expect(readFileSync(join(root, "README.md"), "utf8")).toContain("[[31_项目/Project]]");
		expect(readFileSync(join(root, "README.md"), "utf8")).not.toContain("[[32_任务/Project]]");
		expect(readFileSync(join(root, "README.md"), "utf8")).toContain("[[80_Skills/core/example/SKILL]]");
		expect(existsSync(join(root, "30_目标"))).toBe(true);
		expect(existsSync(join(root, "41_认知记录"))).toBe(true);
		expect(existsSync(join(root, "80_Skills/core/example/SKILL.md"))).toBe(true);
		expect(readFileSync(join(root, "90_系统/framework.yaml"), "utf8")).toContain("layout_version: 2");
		expect(existsSync(join(root, applied.backupPath!, "directories/30_项目/Project.md"))).toBe(true);

		const second = migrateLayout(root);
		expect(second).toMatchObject({ fromVersion: 2, applied: false });
		expect(second.moves.every((move) => move.state === "already_migrated")).toBe(true);
		expect(existsSync(join(root, "31_项目/Project.md"))).toBe(true);
	});

	it("rejects a v1 layout when a non-chained v2 destination already contains data", () => {
		const root = vault();
		mkdirSync(join(root, "50_信息雷达"), { recursive: true });
		mkdirSync(join(root, "12_信息雷达"), { recursive: true });
		writeFileSync(join(root, "50_信息雷达/old.md"), "old\n");
		writeFileSync(join(root, "12_信息雷达/new.md"), "new\n");
		expect(() => migrateLayout(root)).toThrow(/目标目录已有 1 个文件/);
		expect(readFileSync(join(root, "50_信息雷达/old.md"), "utf8")).toBe("old\n");
		expect(readFileSync(join(root, "12_信息雷达/new.md"), "utf8")).toBe("new\n");
	});

	it("migrates Project current-task checklists into the shared Task Pool", () => {
		const root = vault();
		const a = createObject(root, { kind: "project", title: "Checklist A", directories, extra: { result_metric: ["a | A | 1"] } });
		const b = createObject(root, { kind: "project", title: "Checklist B", directories, extra: { result_metric: ["b | B | 1"] } });
		for (const project of [a, b]) writeFileSync(join(root, project.path), `${readFileSync(join(root, project.path), "utf8")}\n## 当前任务\n\n- [ ] 共享调研\n`);
		const preview = migrateTaskPool(root, true);
		expect(preview.changedPaths).toContain("32_任务/共享调研.md");
		migrateTaskPool(root);
		const task = readFileSync(join(root, "32_任务/共享调研.md"), "utf8");
		expect(task).toContain(`[[${a.path.replace(/\.md$/, "")}]]`);
		expect(task).toContain(`[[${b.path.replace(/\.md$/, "")}]]`);
		for (const project of [a, b]) expect(readFileSync(join(root, project.path), "utf8")).toContain("- [[32_任务/共享调研]]");
	});

	it("builds a fingerprinted PlanningContext and persists recommendation feedback", () => {
		const root = vault();
		const goal = createObject(root, { kind: "goal", title: "Ship", directories, extra: { period: "2027-H1", allocation_weight: 100, metric: ["发布 1 个成果"] } });
		setGoalWeights(root, { period: "2027-H1", humanConfirmed: true, changes: [{ path: goal.path, allocationWeight: 100, targetStatus: "active" }] });
		const project = createObject(root, { kind: "project", title: "Aligned", directories, extra: { primary_goal: `[[${goal.path.replace(/\.md$/, "")}]]`, goal_alignment: "direct", result_metric: ["ship | 发布数 | 1"] } });
		const task = createObject(root, { kind: "task", title: "Deliver", directories, extra: { projects: [`[[${project.path.replace(/\.md$/, "")}]]`], estimate_minutes: 60, energy: "high", work_mode: "deep" } });
		const deferred = createObject(root, { kind: "task", title: "Later", directories });
		deferTask(root, { path: deferred.path, deferUntil: "2027-01-10" });
		const context = buildPlanningContext(root, { date: "2027-01-05", availableMinutes: 120, energy: "high" });
		expect(context).toMatchObject({ period: "2027-H1", constraints: { availableMinutes: 120 }, goals: [{ weight: 100 }] });
		expect(context.fingerprint).toHaveLength(24);
		expect(context.taskPool.deferred.map((item) => item.path)).toContain(deferred.path);
		const plan = startDay(root, { date: "2027-01-05", availableMinutes: 120, energy: "high" });
		const generatingPlan = readFileSync(resolve(root, plan.path), "utf8");
		expect(generatingPlan).toContain("recommendation_status: generating");
		expect(generatingPlan).toContain("Agent 正在结合目标、项目、任务、约束和个人画像生成建议");
		expect(plan.recommendations.map((item) => item.taskPath)).toContain(task.path);
		expect(plan.recommendations.map((item) => item.taskPath)).not.toContain(deferred.path);
		const recommendation = plan.recommendations.find((item) => item.taskPath === task.path)!;
		const llmRecommendation = {
			...recommendation,
			reason: "LLM 比较目标缺口、截止时间和今日精力后选择",
			tradeoff: "先放弃低支持度的维护事项",
		};
		saveDailyPlan(root, {
			date: "2027-01-05",
			runId: plan.runId,
			contextFingerprint: plan.context.fingerprint,
			recommendations: [llmRecommendation],
		});
		const savedPlan = readFileSync(resolve(root, plan.path), "utf8");
		expect(savedPlan).toContain("LLM 比较目标缺口、截止时间和今日精力后选择");
		expect(savedPlan).toContain("先放弃低支持度的维护事项");
		expect(() => saveDailyPlan(root, {
			date: "2027-01-05",
			runId: "stale-run",
			contextFingerprint: plan.context.fingerprint,
			recommendations: [llmRecommendation],
		})).toThrow(/stale/);
		recordRecommendationFeedback(root, { date: "2027-01-05", runId: plan.runId, recommendationId: recommendation.id, action: "accepted" });
		expect(listTaskPool(root, "2027-01-05").scheduled.map((item) => item.path)).toContain(task.path);
		expect(readFileSync(join(root, plan.path), "utf8")).toContain("status: accepted");
	});

	it("writes daily, weekly and monthly reviews to their durable Vault paths", () => {
		const root = vault();
		const daily = endDay(root, "2027-01-05");
		const weekly = reviewWeek(root, "2027-01-05");
		const monthly = reviewMonth(root, "2027-01-05");
		expect(daily.path).toBe("40_日记/2027/01/2027-01-05.md");
		expect(weekly.path).toMatch(/^41_认知记录\/周期复盘\/2027-W\d\d\.md$/);
		expect(monthly.path).toBe("41_认知记录/周期复盘/2027-01.md");
		for (const path of [daily.path, weekly.path, monthly.path]) expect(existsSync(join(root, path))).toBe(true);
	});

	it("loads Capability Focus only for matching workflows and applies it to at most one daily recommendation", () => {
		const root = vault();
		const profile = createObject(root, { kind: "personal_operating_profile", title: "Focus", directories });
		const profilePath = join(root, profile.path);
		writeFileSync(profilePath, readFileSync(profilePath, "utf8")
			.replace("status: draft", "status: active")
			.replace('period: ""', "period: 2027-H1")
			.replace('name: ""', "name: 总结能力")
			.replace('behavior: ""', "behavior: 将复杂材料压缩为结构化结论")
			.replace("applies_to: []", "applies_to: [start-day, weekly-review]")
			.replace("status: draft\nreviewed:", "status: active\nreviewed:"));
		for (const title of ["Deep A", "Deep B", "Deep C"]) createObject(root, { kind: "task", title, directories, extra: { work_mode: "deep", growth_mode: "practice" } });
		const plan = startDay(root, { date: "2027-01-05" });
		expect(plan.context.capabilityFocus).toMatchObject({ name: "总结能力", maxDailyRecommendations: 1 });
		expect(plan.recommendations.filter((item) => item.capabilityFocusUsed)).toHaveLength(1);
	});

	it("completes a shared Task with per-Project contribution evidence atomically", () => {
		const root = vault();
		const a = createObject(root, { kind: "project", title: "A", directories, extra: { result_metric: ["a | A output | 1"] } });
		const b = createObject(root, { kind: "project", title: "B", directories, extra: { process_metric: ["b | B research | 1"] } });
		const task = createObject(root, {
			kind: "task", title: "Shared", directories,
			extra: { projects: [`[[${a.path.replace(/\.md$/, "")}]]`, `[[${b.path.replace(/\.md$/, "")}]]`] },
		});
		const result = completeTask(root, {
			path: task.path, result: "Completed shared research", outputs: ["[[21_研究/Shared]]"],
			contributions: [
				{ project: `[[${a.path.replace(/\.md$/, "")}]]`, level: "strong", evidence: "直接完成 A 的交付物" },
				{ project: `[[${b.path.replace(/\.md$/, "")}]]`, level: "incidental", evidence: "只有主题相近" },
			],
		});
		expect(result).toMatchObject({ projectPaths: [a.path], validation: { passed: true } });
		expect(readFileSync(join(root, a.path), "utf8")).toContain("贡献 strong");
		expect(readFileSync(join(root, b.path), "utf8")).not.toContain("贡献 incidental");
	});

	it("creates H1/H2 Goal drafts and atomically activates a 100 percent allocation", () => {
		const root = vault();
		const first = createObject(root, {
			kind: "goal", title: "研究表达", directories,
			extra: { period: "2027-H1", allocation_weight: 60, metric: ["发布 3 篇研究文章"] },
		});
		const second = createObject(root, {
			kind: "goal", title: "产品验证", directories,
			extra: { period: "2027-H1", allocation_weight: 40, metric: ["完成 2 次用户验证"] },
		});
		expect(first.path).toBe("30_目标/2027-H1/研究表达.md");
		expect(() => transitionStatus(root, { path: first.path, target: "active" })).toThrow(/human confirmation/);
		const result = setGoalWeights(root, {
			period: "2027-H1", humanConfirmed: true,
			changes: [
				{ path: first.path, allocationWeight: 60, targetStatus: "active" },
				{ path: second.path, allocationWeight: 40, targetStatus: "active" },
			],
		});
		expect(result).toMatchObject({ activeTotal: 100, validation: { passed: true } });
		expect(readFileSync(join(root, first.path), "utf8")).toContain("status: active");
	});

	it("rolls back Goal allocation batches whose active total is not 100", () => {
		const root = vault();
		const goal = createObject(root, { kind: "goal", title: "Invalid", directories, extra: { period: "2027-H2" } });
		expect(() => setGoalWeights(root, {
			period: "2027-H2", humanConfirmed: true,
			changes: [{ path: goal.path, allocationWeight: 80, targetStatus: "active" }],
		})).toThrow(/active Goal 投入占比合计/);
		expect(readFileSync(join(root, goal.path), "utf8")).toContain("status: draft");
	});

	it("edits Goal result definitions behind confirmation and reviews health without mutating it", () => {
		const root = vault();
		const goal = createObject(root, { kind: "goal", title: "Outcome", directories, extra: { period: "2027-H1", allocation_weight: 100, metric: ["旧指标"] } });
		setGoalWeights(root, { period: "2027-H1", humanConfirmed: true, changes: [{ path: goal.path, allocationWeight: 100, targetStatus: "active" }] });
		expect(() => updateGoal(root, { path: goal.path, metrics: ["发布 2 个成果"] })).toThrow(/human confirmation/);
		updateGoal(root, { path: goal.path, expectedResults: ["交付可验证成果"], metrics: ["发布 2 个成果"], notDoing: ["不做无关扩展"], appendEvidence: ["已发布第一篇成果"], humanConfirmed: true });
		updateGoal(root, { path: goal.path, appendEvidence: ["已发布第一篇成果"] });
		const content = readFileSync(join(root, goal.path), "utf8");
		expect(content).toContain("- 发布 2 个成果");
		expect(content).toContain("result_evidence:\n  - 已发布第一篇成果");
		expect(content.match(/已发布第一篇成果/g)).toHaveLength(2);
		const review = reviewGoalHealth(root, goal.path, "2027-02-01");
		expect(review).toMatchObject({ current: "unknown", suggested: "on_track", evidenceCount: 1, requiresConfirmation: true });
		expect(readFileSync(join(root, goal.path), "utf8")).toContain("health: unknown");
	});

	it("creates the migrated research, reflection, watch and processing object types", () => {
		const root = vault();
		const research = createObject(root, {
			kind: "research",
			title: "Harness Engineering",
			directories,
			extra: {
				question: "Harness 应该负责什么？", area: "[[系统]]", category: "系统",
				related_source: ["[[Source A]]"], concept_candidate: ["Context Engineering"],
			},
		});
		expect(research.path).toBe("21_研究/系统/Harness Engineering.md");
		expect(research.validation.passed).toBe(true);
		const researchContent = readFileSync(join(root, research.path), "utf8");
		expect(researchContent).toContain('related_sources:\n  - "[[Source A]]"');
		expect(researchContent).toContain("- [[Source A]]");
		expect(researchContent).toContain("- Context Engineering");

		const reflection = createObject(root, { kind: "reflection", title: "今天的判断", directories });
		expect(reflection.path).toBe("41_认知记录/今天的判断_反思.md");

		const topic = createObject(root, { kind: "topic_watch", title: "Agent", directories });
		expect(topic.path).toBe("12_信息雷达/主题监控/Agent.md");

		const company = createObject(root, { kind: "company_watch", title: "Example", directories, extra: { tag: ["radar"] } });
		const companyContent = readFileSync(join(root, company.path), "utf8");
		expect(companyContent).toContain('company: "Example"');
		expect(companyContent).toContain("tags:\n  - radar");

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

	it("creates, appends and deduplicates Reader extracts while updating the Source", () => {
		const root = vault();
		const source = createObject(root, { kind: "source", title: "Reader Paper", directories, extra: { format: "paper" } });
		mkdirSync(join(root, "附件"), { recursive: true });
		writeFileSync(join(root, "附件/paper.pdf"), "pdf fixture");
		const firstInput = {
			sourcePath: source.path,
			documentPath: "附件/paper.pdf",
			kind: "pdf" as const,
			location: "page:3",
			positionLabel: "第 3 页",
			text: "First selected passage",
			note: "Connect this claim to the project decision.",
			color: "blue" as const,
			anchor: { format: "pdf" as const, page: 3, rects: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.04 }], quote: "First selected passage" },
			directories,
		};
		const first = appendReaderExtract(root, firstInput);
		expect(first).toMatchObject({ created: true, duplicate: false, validation: { passed: true } });
		expect(first.path).toBe("20_处理区/摘录/Reader Paper_摘录.md");
		const firstContent = readFileSync(join(root, first.path), "utf8");
		expect(firstContent).toContain("> First selected passage");
		expect(firstContent).toContain("- 位置：第 3 页");
		expect(firstContent).toContain("- 原文件：[[附件/paper.pdf]]");
		expect(firstContent).toContain("- 批注：Connect this claim to the project decision.");
		expect(firstContent).toContain("<!-- kos-reader:");
		expect(firstContent).toContain(`^${first.extractId}`);
		const updatedSource = readFileSync(join(root, source.path), "utf8");
		expect(updatedSource).toContain("status: extracted");
		expect(updatedSource).toContain("[[20_处理区/摘录/Reader Paper_摘录]]");

		const duplicate = appendReaderExtract(root, firstInput);
		expect(duplicate).toMatchObject({ created: false, duplicate: true, extractId: first.extractId });
		expect(readFileSync(join(root, first.path), "utf8").match(new RegExp(`kos-reader-extract:start ${first.extractId}`, "g"))).toHaveLength(1);

		const second = appendReaderExtract(root, {
			...firstInput,
			location: "page:4",
			positionLabel: "第 4 页",
			text: "Second selected passage",
			note: "",
			anchor: { format: "pdf", page: 4, rects: [], quote: "Second selected passage" },
		});
		expect(second).toMatchObject({ created: false, duplicate: false });
		const finalContent = readFileSync(join(root, first.path), "utf8");
		expect(finalContent).toContain("> First selected passage");
		expect(finalContent).toContain("> Second selected passage");

		const listed = listReaderAnnotations(root, { sourcePath: source.path });
		expect(listed.extractPath).toBe(first.path);
		expect(listed.annotations).toHaveLength(2);
		expect(listed.annotations[0]).toMatchObject({ id: first.extractId, color: "blue", note: "Connect this claim to the project decision.", anchor: { format: "pdf", page: 3 } });

		const deleted = deleteReaderAnnotation(root, { sourcePath: source.path, extractId: first.extractId });
		expect(deleted).toMatchObject({ deleted: true, extractId: first.extractId, validation: { passed: true } });
		const afterDelete = readFileSync(join(root, first.path), "utf8");
		expect(afterDelete).not.toContain("First selected passage");
		expect(afterDelete).toContain("Second selected passage");
		expect(() => deleteReaderAnnotation(root, { sourcePath: source.path, extractId: first.extractId })).toThrow(/Unknown/);
	});

	it("marks AI extracts as mixed and rejects invalid Reader selections", () => {
		const root = vault();
		const source = createObject(root, { kind: "source", title: "Mixed Extract", directories, extra: { format: "book" } });
		writeFileSync(join(root, "book.epub"), "epub fixture");
		const extract = createObject(root, {
			kind: "extract",
			title: "Mixed Extract",
			directories,
			extra: { source: `[[${source.path.replace(/\.md$/, "")}]]`, extracted_by: "ai" },
		});
		const sourcePath = join(root, source.path);
		writeFileSync(sourcePath, readFileSync(sourcePath, "utf8").replace('extract_file: ""', `extract_file: "[[${extract.path.replace(/\.md$/, "")}]]"`));
		const input = {
			sourcePath: source.path,
			documentPath: "book.epub",
			kind: "epub" as const,
			location: "epubcfi(/6/2)",
			positionLabel: "第 1 章",
			text: "Human selection",
			directories,
		};
		expect(appendReaderExtract(root, input).validation.passed).toBe(true);
		expect(readFileSync(join(root, extract.path), "utf8")).toContain("extracted_by: mixed");
		expect(() => appendReaderExtract(root, { ...input, text: " \n " })).toThrow(/empty/);
		expect(() => appendReaderExtract(root, { ...input, text: "x".repeat(20_001) })).toThrow(/exceeds/);
	});

	it("updates Project sections and rolls the result through validation", () => {
		const root = vault();
		const project = createObject(root, { kind: "project", title: "Migrate", directories, extra: { process_metric: ["migration | 迁移批次 | 1"] } });
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

	it("updates stable Project metrics with evidence and separates completion from success", () => {
		const root = vault();
		const project = createObject(root, { kind: "project", title: "Experiment", directories, extra: { result_metric: ["validated | 完成验证次数 | 1 | experiments"] } });
		updateProject(root, { query: project.path, metricUpdates: [{ id: "validated", current: 1, evidence: "完成对照实验并保存结果" }] });
		const updated = readFileSync(join(root, project.path), "utf8");
		expect(updated).toContain("current: 1");
		expect(updated).toContain("完成对照实验并保存结果");
		expect(() => updateProject(root, { query: project.path, status: "completed" })).toThrow(/validationCompleted/);
		updateProject(root, { query: project.path, status: "completed", validationCompleted: true, expectedResultAchieved: false, finalInsights: ["原假设不成立"] });
		const completed = readFileSync(join(root, project.path), "utf8");
		expect(completed).toContain("validation_completed: true");
		expect(completed).toContain("expected_result_achieved: false");
	});

	it("generates daily artifacts and preserves manual blocks", () => {
		const root = vault();
		createObject(root, { kind: "project", title: "Daily", directories, extra: { process_metric: ["daily | 每日推进次数 | 1"] } });
		const now = new Date(2026, 6, 20, 9, 30, 0);
		const dashboard = generateDailyDashboard(root, now);
		expect(dashboard).toMatchObject({ path: "00_工作台/今日工作台.md", validation: { passed: true } });
		const dashboardPath = join(root, dashboard.path);
		const edited = readFileSync(dashboardPath, "utf8").replace("- 今日主线：", "- 今日主线：迁移 Harness");
		writeFileSync(dashboardPath, edited);
		generateDailyDashboard(root, new Date(2026, 6, 20, 10, 0, 0));
		expect(readFileSync(dashboardPath, "utf8")).toContain("今日主线：迁移 Harness");

		const brief = generateDailyBrief(root, now);
		expect(brief).toMatchObject({ path: "12_信息雷达/每日简报/2026-07-20.md", validation: { passed: true } });
		const diary = generateDiary(root, now);
		expect(diary).toMatchObject({ path: "40_日记/2026/07/2026-07-20.md", validation: { passed: true } });
	});
});
