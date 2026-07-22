import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { parseDocument, stringify } from "yaml";
import { parseFrontmatterFile } from "../validation/frontmatter.ts";
import { validateChangedFiles, validateVault } from "../validation/validate.ts";
import { atomicWrite, resolveInsideRoot } from "./files.ts";
import { createObject, sanitizeFileName } from "./create-object.ts";
import { deferTask, listTaskPool, updateTask } from "./task-pool.ts";
import type {
	CapabilityFocusSummary,
	DailyRecommendation,
	PlanningContext,
	PlanningGoal,
	PlanningProject,
	RecommendationFeedbackInput,
	ReviewResult,
	StartDayInput,
	StartDayResult,
	TaskEnergy,
	TaskMigrationResult,
	TaskPoolEntry,
} from "./types.ts";

const FRONTMATTER = /^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MANAGED_START = "<!-- kos:managed:start -->";
const MANAGED_END = "<!-- kos:managed:end -->";

interface RecordItem {
	path: string;
	fm: Record<string, unknown>;
	body: string;
}

function dateString(value = new Date()): string {
	return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function parseDate(value: string): Date {
	if (!DATE.test(value)) throw new Error(`Date must use YYYY-MM-DD: ${value}`);
	const [year, month, day] = value.split("-").map(Number);
	return new Date(year, month - 1, day, 12);
}

function currentPeriod(date: string): string {
	return `${date.slice(0, 4)}-${Number(date.slice(5, 7)) <= 6 ? "H1" : "H2"}`;
}

function files(directory: string): string[] {
	if (!existsSync(directory)) return [];
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = resolve(directory, entry.name);
		return entry.isDirectory() ? files(path) : entry.isFile() && path.endsWith(".md") ? [path] : [];
	}).sort();
}

function records(root: string, directories: string[]): RecordItem[] {
	return directories.flatMap((directory) => files(resolve(root, directory))).map((path) => {
		const parsed = parseFrontmatterFile(path);
		return { path: relative(resolve(root), path).split(sep).join("/"), fm: parsed.frontmatter ?? {}, body: parsed.body };
	});
}

function strings(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim() !== "") : [];
}

function yamlValue(value: unknown): unknown {
	return value && typeof value === "object" && "toJSON" in value && typeof value.toJSON === "function" ? value.toJSON() : value;
}

function linkPath(value: string): string {
	const match = /^\[\[([^|#]+)(?:[|#].*)?\]\]$/.exec(value.trim());
	return `${(match?.[1] ?? value).replace(/\.md$/, "")}.md`;
}

function stable(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(stable);
	if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)]));
	return value;
}

function fingerprint(value: unknown): string {
	return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex").slice(0, 24);
}

function writeMarkdown(root: string, path: string, frontmatter: Record<string, unknown>, body: string): { path: string; validation: ReturnType<typeof validateChangedFiles> } {
	const target = resolveInsideRoot(root, path);
	const original = existsSync(target.absolute) ? readFileSync(target.absolute, "utf8") : undefined;
	const content = `---\n${stringify(frontmatter).trim()}\n---\n${body.trim()}\n`;
	mkdirSync(dirname(target.absolute), { recursive: true });
	atomicWrite(target.absolute, content);
	const validation = validateChangedFiles(root, [target.absolute]);
	if (!validation.passed) {
		if (original !== undefined) atomicWrite(target.absolute, original);
		throw new Error(`Workflow write failed validation: ${JSON.stringify(validation.findings)}`);
	}
	return { path: target.relative, validation };
}

export function migrateTaskPool(root: string, dryRun = false): TaskMigrationResult {
	const taskFiles = files(resolve(root, "32_任务"));
	const originals = new Map<string, string>();
	const rendered = new Map<string, string>();
	for (const path of taskFiles) {
		const original = readFileSync(path, "utf8");
		const match = FRONTMATTER.exec(original);
		if (!match) continue;
		const document = parseDocument(match[1]);
		if (document.errors.length || document.get("type") !== "task") continue;
		const before = document.toString();
		const legacy = String(document.get("project") ?? "").trim();
		const projects = [...new Set([...strings(yamlValue(document.get("projects"))), ...(legacy ? [legacy] : [])])];
		document.set("projects", projects);
		if (document.has("project")) document.delete("project");
		const defaults: Record<string, unknown> = {
			status: "todo", priority: "P2", scheduled_for: "", defer_until: "", due: "", estimate_minutes: 30,
			energy: "medium", work_mode: "shallow", growth_mode: "neutral", scheduled_times: [], completed: "",
			result: "", outputs: [], blocked_reason: "", unblock_condition: "", project_contributions: [], recommendation_history: [], tags: [],
		};
		for (const [key, value] of Object.entries(defaults)) if (!document.has(key)) document.set(key, value);
		const status = String(document.get("status") ?? "todo");
		if (status === "done" && !String(document.get("result") ?? "").trim()) document.set("result", "迁移前已完成；原记录未保存结构化结果");
		if (status === "done" && projects.length && strings(yamlValue(document.get("project_contributions"))).length !== projects.length) {
			document.set("project_contributions", projects.map((project) => `${project} | incidental | 迁移前未记录贡献判断，待人工复核`));
		}
		if (status === "blocked") {
			if (!String(document.get("blocked_reason") ?? "").trim()) document.set("blocked_reason", "迁移前未记录阻塞原因，待人工补充");
			if (!String(document.get("unblock_condition") ?? "").trim()) document.set("unblock_condition", "人工复核阻塞条件");
		}
		if (!document.has("created") || !DATE.test(String(document.get("created") ?? ""))) document.set("created", dateString());
		if (document.toString() !== before) {
			originals.set(path, original);
			rendered.set(path, `---\n${document.toString().trim()}\n---\n${original.slice(match[0].length)}`);
		}
	}
	const checklistCandidates = projectChecklistCandidates(root);
	const previewPaths = [...rendered.keys()].map((path) => relative(resolve(root), path).split(sep).join("/"));
	for (const candidate of checklistCandidates) previewPaths.push(candidate.taskPath, candidate.projectPath);
	if (dryRun) return { scanned: taskFiles.length, changedPaths: [...new Set(previewPaths)], validation: validateChangedFiles(root, []) };
	if (rendered.size === 0 && checklistCandidates.length === 0) return { scanned: taskFiles.length, changedPaths: [], validation: validateChangedFiles(root, []) };
	const createdTasks: string[] = [];
	try {
		for (const [path, content] of rendered) atomicWrite(path, content);
		const projectChanges = new Map<string, string>();
		for (const candidate of checklistCandidates) {
			if (!existsSync(resolve(root, candidate.taskPath))) {
				const created = createObject(root, { kind: "task", title: candidate.title, directories: { project: "31_项目", concept: "22_知识库", method: "23_方法库", task: "32_任务", source: "11_原材料" }, extra: { projects: [`[[${candidate.projectPath.replace(/\.md$/, "")}]]`] } });
				createdTasks.push(created.path);
			} else {
				const absoluteTask = resolve(root, candidate.taskPath);
				if (!originals.has(absoluteTask)) originals.set(absoluteTask, readFileSync(absoluteTask, "utf8"));
				const parsed = parseFrontmatterFile(absoluteTask).frontmatter ?? {};
				const legacy = String(parsed.project ?? "").trim();
				const projectRef = `[[${candidate.projectPath.replace(/\.md$/, "")}]]`;
				updateTask(root, { path: candidate.taskPath, projects: [...new Set([...strings(parsed.projects), ...(legacy ? [legacy] : []), projectRef])] });
			}
			const absoluteProject = resolve(root, candidate.projectPath);
			if (!originals.has(absoluteProject)) originals.set(absoluteProject, readFileSync(absoluteProject, "utf8"));
			const current = projectChanges.get(absoluteProject) ?? readFileSync(absoluteProject, "utf8");
			projectChanges.set(absoluteProject, current.replace(candidate.line, `- [[${candidate.taskPath.replace(/\.md$/, "")}]]`));
		}
		for (const [path, content] of projectChanges) atomicWrite(path, content);
		const changed = [...rendered.keys(), ...projectChanges.keys(), ...checklistCandidates.map((item) => resolve(root, item.taskPath))];
		const validation = validateChangedFiles(root, changed);
		if (!validation.passed) throw new Error(`Task migration failed validation: ${JSON.stringify(validation.findings)}`);
		return { scanned: taskFiles.length, changedPaths: [...new Set(changed.map((path) => relative(resolve(root), path).split(sep).join("/")))], validation };
	} catch (error) {
		for (const [path, content] of originals) atomicWrite(path, content);
		for (const path of createdTasks) if (existsSync(resolve(root, path))) unlinkSync(resolve(root, path));
		throw error;
	}
}

function projectChecklistCandidates(root: string): Array<{ projectPath: string; taskPath: string; title: string; line: string }> {
	const result: Array<{ projectPath: string; taskPath: string; title: string; line: string }> = [];
	for (const item of records(root, ["31_项目"]).filter((record) => record.fm.type === "project")) {
		const heading = /^## 当前任务\s*$/m.exec(item.body);
		if (!heading) continue;
		const start = (heading.index ?? 0) + heading[0].length;
		const rest = item.body.slice(start);
		const end = /^## /m.exec(rest)?.index ?? rest.length;
		for (const match of rest.slice(0, end).matchAll(/^- \[ \] (.+?)\s*$/gm)) {
			const title = match[1].trim();
			const name = sanitizeFileName(title);
			if (name) result.push({ projectPath: item.path, taskPath: `32_任务/${name}.md`, title, line: match[0] });
		}
	}
	return result;
}

function capabilityFocus(items: RecordItem[], period: string, workflow: string): CapabilityFocusSummary | undefined {
	for (const item of items.filter((entry) => entry.fm.type === "personal_operating_profile" && entry.fm.status === "active")) {
		const focus = item.fm.capability_focus;
		if (!focus || typeof focus !== "object" || Array.isArray(focus)) continue;
		const map = focus as Record<string, unknown>;
		const appliesTo = strings(map.applies_to);
		if (map.status !== "active" || map.period !== period || !appliesTo.includes(workflow)) continue;
		return {
			period, name: String(map.name ?? ""), behavior: String(map.behavior ?? ""), appliesTo,
			maxDailyRecommendations: Math.max(0, Math.min(3, Number(map.max_daily_recommendations ?? 1))),
		};
	}
	return undefined;
}

function taskProjects(task: RecordItem): string[] {
	const legacy = String(task.fm.project ?? "").trim();
	return [...new Set([...strings(task.fm.projects), ...(legacy ? [legacy] : [])].map(linkPath))];
}

export function buildPlanningContext(root: string, input: StartDayInput = {}): PlanningContext {
	const date = input.date ?? dateString();
	parseDate(date);
	const period = currentPeriod(date);
	const all = records(root, ["30_目标", "31_项目", "32_任务", "40_日记", "42_个人操作画像"]);
	const goalsByPath = new Map(all.filter((item) => item.fm.type === "goal").map((item) => [item.path, item]));
	const projects = all.filter((item) => item.fm.type === "project");
	const projectsByPath = new Map(projects.map((item) => [item.path, item]));
	const tasks = all.filter((item) => item.fm.type === "task");
	const cutoff = dateString(new Date(parseDate(date).getTime() - 27 * 86_400_000));
	const minutesByGoal = new Map<string, number>();
	for (const task of tasks.filter((item) => String(item.fm.completed ?? "") >= cutoff && String(item.fm.completed ?? "") <= date)) {
		const taskMinutes = Number(task.fm.estimate_minutes ?? 0);
		const goalPaths = [...new Set(taskProjects(task).flatMap((path) => {
			const project = projectsByPath.get(path);
			if (!project) return [];
			return [String(project.fm.primary_goal ?? ""), ...strings(project.fm.supporting_goals)].filter(Boolean).map(linkPath);
		}))];
		for (const goalPath of goalPaths) minutesByGoal.set(goalPath, (minutesByGoal.get(goalPath) ?? 0) + taskMinutes / Math.max(goalPaths.length, 1));
	}
	const totalMinutes = [...minutesByGoal.values()].reduce((sum, value) => sum + value, 0);
	const goals: PlanningGoal[] = [...goalsByPath.values()].filter((item) => item.fm.period === period && item.fm.status === "active").map((item) => {
		const recentMinutes = Math.round(minutesByGoal.get(item.path) ?? 0);
		const recentShare = totalMinutes ? Math.round(recentMinutes / totalMinutes * 1000) / 10 : 0;
		const weight = Number(item.fm.allocation_weight ?? 0);
		return { path: item.path, title: String(item.fm.title ?? ""), weight, health: String(item.fm.health ?? "unknown"), recentMinutes, recentShare, allocationDelta: Math.round((weight - recentShare) * 10) / 10 };
	});
	const planningProjects: PlanningProject[] = projects.filter((item) => ["active", "blocked", "idea"].includes(String(item.fm.status))).map((item) => ({
		path: item.path, title: String(item.fm.title ?? ""), status: String(item.fm.status), alignment: String(item.fm.goal_alignment ?? "off_goal"),
		goals: [String(item.fm.primary_goal ?? ""), ...strings(item.fm.supporting_goals)].filter(Boolean).map(linkPath),
		nextMilestone: String(item.fm.next_milestone ?? ""), due: String(item.fm.due ?? ""),
	}));
	const yesterday = dateString(new Date(parseDate(date).getTime() - 86_400_000));
	const yesterdayUnfinished = tasks.filter((item) => item.fm.scheduled_for === yesterday && !["done", "cancelled"].includes(String(item.fm.status))).map((item) => item.path);
	const validation = validateVault(root);
	const base = {
		date, period, goals, projects: planningProjects, taskPool: listTaskPool(root, date), yesterdayUnfinished,
		constraints: { availableMinutes: input.availableMinutes, energy: input.energy, hardConstraints: input.hardConstraints ?? [] },
		capabilityFocus: capabilityFocus(all, period, "start-day"),
		validatorFindings: validation.findings.filter((item) => item.level !== "INFO").map(({ level, path, message }) => ({ level, path, message })),
	};
	return { ...base, fingerprint: fingerprint(base) };
}

function priority(task: TaskPoolEntry): number {
	return ({ P0: 50, P1: 40, P2: 30, P3: 20, P4: 10 } as Record<string, number>)[task.priority] ?? 0;
}

function recommend(context: PlanningContext): DailyRecommendation[] {
	const projectByPath = new Map(context.projects.map((project) => [project.path, project]));
	const goalByPath = new Map(context.goals.map((goal) => [goal.path, goal]));
	const candidates = [...context.taskPool.doing, ...context.taskPool.available, ...context.taskPool.scheduled].filter((task, index, all) => all.findIndex((item) => item.path === task.path) === index);
	const scored = candidates.map((task) => {
		const projects = task.projects.map(linkPath);
		const projectObjects = projects.map((path) => projectByPath.get(path)).filter((item): item is PlanningProject => item !== undefined);
		const goals = [...new Set(projectObjects.flatMap((project) => project.goals))];
		const align = Math.max(0, ...projectObjects.map((project) => ({ direct: 30, enabling: 20, exploratory: 5, off_goal: -30, conflicting: -50 }[project.alignment] ?? 0)));
		const delta = Math.max(0, ...goals.map((path) => goalByPath.get(path)?.allocationDelta ?? 0));
		const overdue = task.due && task.due < context.date ? 80 : task.due === context.date ? 65 : 0;
		const doing = task.status === "doing" ? 70 : 0;
		const hard = task.priority === "P0" ? 100 : 0;
		return { task, projects, goals, score: priority(task) + align + delta + overdue + doing + hard, hard: Boolean(overdue || doing || hard), projectObjects };
	}).filter((item) => item.hard || !item.projectObjects.some((project) => ["off_goal", "conflicting"].includes(project.alignment)));
	scored.sort((a, b) => b.score - a.score || a.task.path.localeCompare(b.task.path));
	let capabilityUses = 0;
	return scored.slice(0, 3).map((item, index) => {
		const capabilityFocusUsed = Boolean(context.capabilityFocus && capabilityUses < context.capabilityFocus.maxDailyRecommendations && (item.task.growthMode !== "neutral" || item.task.workMode === "deep"));
		if (capabilityFocusUsed) capabilityUses += 1;
		const goalReason = item.goals.map((path) => goalByPath.get(path)).filter(Boolean).map((goal) => `${goal?.title}（待补投入 ${goal?.allocationDelta}%）`).join("、");
		return {
			id: `r${index + 1}-${fingerprint(item.task.path).slice(0, 8)}`, taskPath: item.task.path, title: item.task.title, status: "recommended",
			reason: item.hard ? "优先处理已开始、到期或外部硬承诺事项" : goalReason ? `支持 ${goalReason}` : "任务池中的必要维护或零散事项",
			goals: item.goals, projects: item.projects, estimateMinutes: item.task.estimateMinutes,
			tradeoff: index === 0 ? "占用今天的主要专注时间" : "仅在主线和硬承诺之后投入",
			capabilityFocusUsed,
		};
	});
}

function planBody(context: PlanningContext, recommendations: DailyRecommendation[]): string {
	const lines = recommendations.length ? recommendations.map((item) => `- [ ] \`${item.id}\` [[${item.taskPath.replace(/\.md$/, "")}]]：${item.reason}；预计 ${item.estimateMinutes} 分钟；取舍：${item.tradeoff}${item.capabilityFocusUsed ? `；能力练习：${context.capabilityFocus?.name}` : ""}`).join("\n") : "- 暂无建议";
	return `# ${context.date} 每日计划\n\n## 确定性事实\n\n- 进行中：${context.taskPool.doing.length}\n- 今日已选：${context.taskPool.scheduled.length}\n- 阻塞：${context.taskPool.blocked.length}\n- 尚未到推迟日期：${context.taskPool.deferred.length}\n- Validator 异常：${context.validatorFindings.length}\n\n## Agent 建议\n\n${MANAGED_START}\n${lines}\n${MANAGED_END}\n\n## 用户已确认计划\n\n${MANAGED_START}\n- 尚未确认\n${MANAGED_END}\n\n## 用户补充\n\n<!-- 人手动添加 -->\n\n- \n\n<!-- /人手动添加 -->`;
}

export function startDay(root: string, input: StartDayInput = {}): StartDayResult {
	const context = buildPlanningContext(root, input);
	const recommendations = recommend(context);
	const runId = `${context.date}-${context.fingerprint}-${randomUUID().slice(0, 8)}`;
	const result = writeMarkdown(root, `00_工作台/计划/${context.date}.md`, {
		type: "daily_plan", date: context.date, period: context.period, run_id: runId, context_fingerprint: context.fingerprint,
		generated_at: new Date().toISOString(), recommendation_status: "pending", recommendations,
	}, planBody(context, recommendations));
	return { ...result, runId, context, recommendations };
}

export function recordRecommendationFeedback(root: string, input: RecommendationFeedbackInput) {
	parseDate(input.date);
	const target = resolveInsideRoot(root, `00_工作台/计划/${input.date}.md`);
	if (!existsSync(target.absolute)) throw new Error(`Daily plan does not exist: ${target.relative}`);
	const original = readFileSync(target.absolute, "utf8");
	const match = FRONTMATTER.exec(original);
	if (!match) throw new Error("Daily plan has no frontmatter");
	const document = parseDocument(match[1]);
	if (document.get("run_id") !== input.runId) throw new Error("Recommendation run is stale; refresh the daily plan");
	const recommendations = (yamlValue(document.get("recommendations")) ?? []) as DailyRecommendation[];
	const recommendation = recommendations.find((item) => item.id === input.recommendationId);
	if (!recommendation) throw new Error(`Unknown recommendation: ${input.recommendationId}`);
	if (recommendation.status !== "recommended") throw new Error(`Recommendation already resolved: ${recommendation.status}`);
	if (input.action === "deferred") {
		if (!input.deferUntil) throw new Error("Deferred feedback requires deferUntil");
		deferTask(root, { path: recommendation.taskPath, deferUntil: input.deferUntil, reason: input.reason ?? "每日建议中推迟" });
	} else if (input.action === "accepted" || input.action === "adjusted") {
		updateTask(root, { path: recommendation.taskPath, scheduledFor: input.date, deferUntil: "", estimateMinutes: input.estimateMinutes });
	} else {
		const task = resolveInsideRoot(root, recommendation.taskPath);
		const taskOriginal = readFileSync(task.absolute, "utf8");
		const taskMatch = FRONTMATTER.exec(taskOriginal);
		if (taskMatch) {
			const taskDocument = parseDocument(taskMatch[1]);
			const history = strings(yamlValue(taskDocument.get("recommendation_history")));
			history.push(`${input.date} | rejected${input.reason ? ` | ${input.reason}` : ""}`);
			taskDocument.set("recommendation_history", history);
			atomicWrite(task.absolute, `---\n${taskDocument.toString().trim()}\n---\n${taskOriginal.slice(taskMatch[0].length)}`);
		}
	}
	recommendation.status = input.action;
	(recommendation as DailyRecommendation & { feedbackReason?: string }).feedbackReason = input.reason;
	document.set("recommendations", recommendations);
	document.set("recommendation_status", recommendations.every((item) => item.status !== "recommended") ? "resolved" : "pending");
	atomicWrite(target.absolute, `---\n${document.toString().trim()}\n---\n${original.slice(match[0].length)}`);
	const validation = validateChangedFiles(root, [target.absolute]);
	if (!validation.passed) {
		atomicWrite(target.absolute, original);
		throw new Error(`Recommendation feedback failed validation: ${JSON.stringify(validation.findings)}`);
	}
	return { path: target.relative, validation };
}

function periodBounds(kind: "week" | "month", date: string): { key: string; start: string; end: string } {
	const current = parseDate(date);
	if (kind === "month") {
		const year = current.getFullYear(); const month = current.getMonth();
		return { key: `${year}-${String(month + 1).padStart(2, "0")}`, start: dateString(new Date(year, month, 1, 12)), end: dateString(new Date(year, month + 1, 0, 12)) };
	}
	const monday = new Date(current); monday.setDate(current.getDate() - ((current.getDay() + 6) % 7));
	const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
	const firstThursday = new Date(monday); firstThursday.setDate(monday.getDate() + 3);
	const firstYear = new Date(firstThursday.getFullYear(), 0, 4, 12);
	const week = 1 + Math.round((firstThursday.getTime() - firstYear.getTime() - (3 - ((firstYear.getDay() + 6) % 7)) * 86_400_000) / (7 * 86_400_000));
	return { key: `${firstThursday.getFullYear()}-W${String(week).padStart(2, "0")}`, start: dateString(monday), end: dateString(sunday) };
}

function reportSummary(root: string, date: string, kind: "week" | "month") {
	const bounds = periodBounds(kind, date);
	const context = buildPlanningContext(root, { date });
	const all = records(root, ["32_任务", "31_项目", "42_个人操作画像"]);
	const repeated = all.filter((item) => item.fm.type === "task" && strings(item.fm.recommendation_history).filter((line) => /deferred|rejected/.test(line) && line.slice(0, 10) >= bounds.start && line.slice(0, 10) <= bounds.end).length >= 2).map((item) => item.path);
	const offGoalProjects = all.filter((item) => item.fm.type === "project" && ["off_goal", "conflicting"].includes(String(item.fm.goal_alignment)) && ["active", "idea"].includes(String(item.fm.status))).map((item) => item.path);
	const capabilityEvidence = all.filter((item) => item.fm.type === "task" && item.fm.completed && String(item.fm.completed) >= bounds.start && String(item.fm.completed) <= bounds.end && item.fm.growth_mode !== "neutral").map((item) => item.path);
	return { bounds, context, summary: { goalEffort: context.goals, repeatedlyDeferred: repeated, offGoalProjects, capabilityEvidence } };
}

export function endDay(root: string, date = dateString()): ReviewResult {
	parseDate(date);
	const all = records(root, ["32_任务"]);
	const selected = all.filter((item) => item.fm.type === "task" && item.fm.scheduled_for === date);
	const completed = all.filter((item) => item.fm.type === "task" && item.fm.completed === date);
	const deferred = all.filter((item) => item.fm.type === "task" && strings(item.fm.recommendation_history).some((line) => line.startsWith(date) && line.includes("deferred")));
	const rejected = all.filter((item) => item.fm.type === "task" && strings(item.fm.recommendation_history).some((line) => line.startsWith(date) && line.includes("rejected")));
	const list = (items: RecordItem[]) => items.length ? items.map((item) => `- [[${item.path.replace(/\.md$/, "")}]]`).join("\n") : "- 暂无";
	const context = buildPlanningContext(root, { date });
	const result = writeMarkdown(root, `40_日记/${date.slice(0, 4)}/${date.slice(5, 7)}/${date}.md`, {
		type: "diary", created: date, date, day_of_week: parseDate(date).toLocaleDateString("en-US", { weekday: "long" }), week_number: Number(periodBounds("week", date).key.slice(-2)), mood: "", energy: 3, tags: ["daily"],
	}, `# ${date}\n\n## 今日接受与调整\n\n${list(selected)}\n\n## 今日完成与结果\n\n${list(completed)}\n\n## 今日推迟\n\n${list(deferred)}\n\n## 今日拒绝\n\n${list(rejected)}\n\n## Goal 投入提示\n\n${context.goals.map((goal) => `- ${goal.title}：目标 ${goal.weight}% / 近 28 天估算 ${goal.recentShare}%`).join("\n") || "- 暂无 active Goal"}\n\n## 未完成原因与明日继续\n\n<!-- 人手动添加 -->\n\n- \n\n<!-- /人手动添加 -->`);
	return { ...result, period: date, summary: { goalEffort: context.goals, repeatedlyDeferred: deferred.map((item) => item.path), offGoalProjects: [], capabilityEvidence: completed.filter((item) => item.fm.growth_mode !== "neutral").map((item) => item.path) } };
}

function review(root: string, kind: "week" | "month", date = dateString()): ReviewResult {
	const { bounds, context, summary } = reportSummary(root, date, kind);
	const label = kind === "week" ? "周报" : "月报";
	const goalLines = summary.goalEffort.map((goal) => `- ${goal.title}：目标 ${goal.weight}% / 近 28 天估算 ${goal.recentShare}% / 偏差 ${goal.allocationDelta > 0 ? "+" : ""}${goal.allocationDelta}% / 健康度 ${goal.health}`).join("\n") || "- 暂无 active Goal";
	const path = `41_认知记录/周期复盘/${bounds.key}.md`;
	const result = writeMarkdown(root, path, { type: "reflection", title: `${bounds.key} ${label}`, status: "developed", created: date, trigger: `${kind}-review`, review_period: bounds.key, period_start: bounds.start, period_end: bounds.end, context_fingerprint: context.fingerprint, tags: ["review", kind] },
		`# ${bounds.key} ${label}\n\n## Goal 投入与健康\n\n${goalLines}\n\n## Project 指标、里程碑与阻塞\n\n${context.projects.map((project) => `- [[${project.path.replace(/\.md$/, "")}]]：${project.status} / ${project.alignment} / 下一里程碑：${project.nextMilestone || "未设置"}`).join("\n") || "- 暂无"}\n\n## 持续推迟或拒绝\n\n${summary.repeatedlyDeferred.map((path) => `- [[${path.replace(/\.md$/, "")}]]`).join("\n") || "- 暂无"}\n\n## 低支持度投入与目标调整提醒\n\n${summary.offGoalProjects.map((path) => `- [[${path.replace(/\.md$/, "")}]]：尊重继续推进选择；请在本次复盘确认是否调整 Goal、占比或 Project 组合。`).join("\n") || "- 暂无"}\n\n## Capability Focus 证据\n\n${summary.capabilityEvidence.map((path) => `- [[${path.replace(/\.md$/, "")}]]`).join("\n") || "- 本期没有结构化实践证据"}\n\n## 待确认调整建议\n\n${MANAGED_START}\n- 仅生成建议，不自动修改 Goal 权重、Project 方向或个人画像。\n${MANAGED_END}\n\n## 用户结论\n\n<!-- 人手动添加 -->\n\n- \n\n<!-- /人手动添加 -->`);
	return { ...result, period: bounds.key, summary };
}

export function reviewWeek(root: string, date?: string): ReviewResult { return review(root, "week", date); }
export function reviewMonth(root: string, date?: string): ReviewResult { return review(root, "month", date); }
