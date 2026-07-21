import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { globSync } from "glob";
import { parse as parseYaml } from "yaml";
import { parseFrontmatterFile } from "../validation/frontmatter.ts";
import { validateTaskContract } from "../validation/skill-evals.ts";
import { validateSkills } from "../validation/skills.ts";
import { validateSkillEvals } from "../validation/skill-evals.ts";
import { validateVault } from "../validation/validate.ts";

export type TaskCheckType =
	| "path_exists"
	| "path_not_exists"
	| "glob_count"
	| "text_contains"
	| "text_not_contains"
	| "frontmatter"
	| "harness_passes";

export interface TaskCheckDefinition {
	id: string;
	type: TaskCheckType;
	required?: boolean;
	path?: string;
	pattern?: string;
	min?: number;
	max?: number;
	values?: string[];
	field?: string;
	operator?: "nonempty" | "equals" | "contains";
	expected?: unknown;
	validator?: "paths" | "schema" | "state" | "skills" | "skill_evals" | "yolo";
	script?: string;
}

export interface TaskRubricDefinition {
	id: string;
	description: string;
	min_score: number;
	weight?: number;
}

export interface TaskContract {
	version: 1;
	id: string;
	skill: string;
	objective: string;
	max_iterations?: number;
	checks: TaskCheckDefinition[];
	rubric?: TaskRubricDefinition[];
}

export interface TaskSelfAssessment {
	contract_id?: string;
	summary?: string;
	next_action?: string;
	needs_user?: boolean;
	rubric?: Record<string, { score?: number; evidence?: string | string[] }>;
}

export interface TaskCheckResult {
	id: string;
	type: string;
	required: boolean;
	pass: boolean;
	notes: string;
	evidence: string[];
}

export interface TaskRubricResult {
	id: string;
	pass: boolean;
	score: number | null;
	min_score: number;
	weight: number;
	evidence: string[];
	notes: string;
}

export interface TaskAttempt {
	iteration: number;
	pass: boolean;
	score: number;
	deterministic_score: number;
	semantic_score: number | null;
	checks: TaskCheckResult[];
	rubric: TaskRubricResult[];
	failures: string[];
	assessment_summary: string;
	next_action: string;
	needs_user: boolean;
}

export interface TaskRunState {
	kind: "task_completion_run";
	run_id: string;
	contract_id: string;
	contract_sha256: string;
	skill: string;
	objective: string;
	max_iterations: number;
	status: "pass" | "needs_user" | "exhausted" | "retryable";
	metrics: { pass_at_1: boolean; pass_at_k: boolean; iterations: number; best_score: number };
	attempts: TaskAttempt[];
}

export class TaskContractError extends Error {}

export function contractDigest(contract: TaskContract): string {
	return createHash("sha256").update(stableJson(contract)).digest("hex");
}

export function loadTaskContract(path: string): TaskContract {
	const parsed = parseYaml(readFileSync(path, "utf8")) as unknown;
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new TaskContractError("Task Contract 必须是 mapping");
	const errors = validateTaskContract(parsed as Record<string, unknown>);
	if (errors.length) throw new TaskContractError(errors.join("；"));
	return parsed as TaskContract;
}

export function loadSelfAssessment(path?: string): TaskSelfAssessment {
	if (!path) return {};
	const parsed = parseYaml(readFileSync(path, "utf8")) as unknown;
	return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as TaskSelfAssessment : {};
}

export function evaluateTaskContract(
	root: string,
	contract: TaskContract,
	assessment: TaskSelfAssessment = {},
	iteration = 1,
): TaskAttempt {
	const errors = validateTaskContract(contract as unknown as Record<string, unknown>);
	if (errors.length) throw new TaskContractError(errors.join("；"));
	const resolvedRoot = resolve(root);
	const checks = contract.checks.map((check) => evaluateCheck(resolvedRoot, check));
	const { results: rubric, score: semanticScore } = evaluateRubric(contract, assessment);
	const required = checks.filter((check) => check.required);
	const deterministicScore = required.length
		? roundEven(required.filter((check) => check.pass).length / required.length * 100)
		: 100;
	const passed = required.every((check) => check.pass) && rubric.every((item) => item.pass);
	const score = semanticScore === null ? deterministicScore : roundEven((deterministicScore + semanticScore) / 2);
	return {
		iteration,
		pass: passed,
		score,
		deterministic_score: deterministicScore,
		semantic_score: semanticScore,
		checks,
		rubric,
		failures: [
			...checks.filter((check) => check.required && !check.pass).map((check) => check.id),
			...rubric.filter((item) => !item.pass).map((item) => item.id),
		],
		assessment_summary: String(assessment.summary ?? ""),
		next_action: String(assessment.next_action ?? ""),
		needs_user: assessment.needs_user === true,
	};
}

export function updateTaskRunState(
	state: TaskRunState | undefined,
	contract: TaskContract,
	attempt: TaskAttempt,
	runId: string,
): TaskRunState {
	const digest = contractDigest(contract);
	if (state) {
		if (state.contract_id !== contract.id || state.contract_sha256 !== digest) {
			throw new TaskContractError("已有 run state 与当前 Task Contract 不一致");
		}
		if (state.run_id !== runId) throw new TaskContractError("已有 run state 与当前 run id 不一致");
		if (state.status === "pass") throw new TaskContractError("Task Completion Run 已通过，不能继续追加迭代");
	}
	const attempts = [...(state?.attempts ?? [])];
	const expectedIteration = attempts.length + 1;
	if (attempt.iteration !== expectedIteration) throw new TaskContractError(`iteration 应为 ${expectedIteration}`);
	attempts.push(attempt);
	const converged = attempts.some((item) => item.pass);
	const maxIterations = contract.max_iterations ?? 3;
	const status: TaskRunState["status"] = converged
		? "pass"
		: attempt.needs_user
			? "needs_user"
			: attempts.length >= maxIterations
				? "exhausted"
				: "retryable";
	return {
		kind: "task_completion_run",
		run_id: runId,
		contract_id: contract.id,
		contract_sha256: digest,
		skill: contract.skill,
		objective: contract.objective,
		max_iterations: maxIterations,
		status,
		metrics: {
			pass_at_1: attempts[0]?.pass === true,
			pass_at_k: converged,
			iterations: attempts.length,
			best_score: Math.max(...attempts.map((item) => item.score)),
		},
		attempts,
	};
}

function evaluateCheck(root: string, check: TaskCheckDefinition): TaskCheckResult {
	if (check.type === "path_exists" || check.type === "path_not_exists") {
		const path = vaultPath(root, check.path);
		const exists = existsSync(path);
		return checkResult(check, check.type === "path_exists" ? exists : !exists, `exists=${exists}`, [rel(path, root)]);
	}
	if (check.type === "glob_count") {
		const pattern = safeRelative(check.pattern, "pattern");
		const matches = globSync(pattern, { cwd: root, absolute: true, dot: true, nodir: false })
			.filter((path) => inside(path, root))
			.sort();
		const min = check.min ?? 1;
		const pass = matches.length >= min && (check.max === undefined || matches.length <= check.max);
		return checkResult(check, pass, `matches=${matches.length}, expected=${min}..${check.max ?? "∞"}`, matches.slice(0, 20).map((path) => rel(path, root)));
	}
	if (check.type === "text_contains" || check.type === "text_not_contains") {
		const path = vaultPath(root, check.path);
		if (!existsSync(path)) return checkResult(check, false, "目标文件不存在", [rel(path, root)]);
		const text = readFileSync(path, "utf8");
		const found = (check.values ?? []).filter((value) => text.includes(value));
		const pass = check.type === "text_contains" ? found.length === (check.values ?? []).length : found.length === 0;
		return checkResult(check, pass, `matched=${JSON.stringify(found)}`, [rel(path, root)]);
	}
	if (check.type === "frontmatter") {
		const path = vaultPath(root, check.path);
		if (!existsSync(path)) return checkResult(check, false, "目标文件不存在", [rel(path, root)]);
		const parsed = parseFrontmatterFile(path);
		if (parsed.frontmatter === null) return checkResult(check, false, "缺少 frontmatter", [rel(path, root)]);
		const actual = nestedValue(parsed.frontmatter, check.field ?? "");
		const operator = check.operator ?? "nonempty";
		const pass = operator === "nonempty"
			? actual !== undefined && actual !== null && actual !== "" && !(Array.isArray(actual) && actual.length === 0)
			: operator === "equals"
				? deepEqual(actual, check.expected)
				: contains(actual, check.expected);
		return checkResult(check, pass, `actual=${display(actual)}`, [rel(path, root)]);
	}
	if (check.type === "harness_passes") return evaluateHarnessCheck(root, check);
	return checkResult(check, false, `未知检查类型：${check.type}`);
}

function evaluateHarnessCheck(root: string, check: TaskCheckDefinition): TaskCheckResult {
	const script = check.validator ?? check.script ?? "";
	let passed = false;
	let evidence: string[] = [];
	if (["paths", "schema", "state", "validate_paths.py", "validate_schema.py", "validate_state.py"].includes(script)) {
		const validator = script.replace("validate_", "").replace(".py", "");
		const report = validateVault(root);
		evidence = report.findings.filter((item) => item.validator === validator && item.level === "ERROR")
			.slice(0, 10).map((item) => `${item.path}: ${item.message}`);
		passed = evidence.length === 0;
	} else if (script === "skills" || script === "validate_skills.py") {
		const report = validateSkills(root);
		passed = report.passed;
		evidence = report.findings.slice(0, 10).map((item) => `${item.path}: ${item.message}`);
	} else if (script === "skill_evals" || script === "validate_skill_evals.py") {
		const report = validateSkillEvals(root);
		passed = report.passed;
		evidence = report.findings.slice(0, 10).map((item) => `${item.path}: ${item.message}`);
	} else if (script === "yolo" || script === "validate_permissions.py") {
		passed = true;
		evidence = ["legacy permission gate removed: YOLO is the only execution mode"];
	} else {
		return checkResult(check, false, `Harness 不在允许列表：${script}`);
	}
	return checkResult(check, passed, `passed=${passed}`, evidence);
}

function evaluateRubric(contract: TaskContract, assessment: TaskSelfAssessment): { results: TaskRubricResult[]; score: number | null } {
	const definitions = contract.rubric ?? [];
	if (!definitions.length) return { results: [], score: null };
	const provided = assessment.contract_id === contract.id && assessment.rubric ? assessment.rubric : {};
	let weighted = 0;
	let totalWeight = 0;
	const results = definitions.map((definition): TaskRubricResult => {
		const response = provided[definition.id] ?? {};
		const validScore = typeof response.score === "number" && response.score >= 0 && response.score <= 4;
		const rawEvidence = typeof response.evidence === "string" ? [response.evidence] : response.evidence;
		const evidence = Array.isArray(rawEvidence) && rawEvidence.length > 0 && rawEvidence.every(nonEmpty) ? rawEvidence : [];
		const score = validScore ? response.score! : 0;
		const weight = definition.weight ?? 1;
		weighted += score * weight;
		totalWeight += 4 * weight;
		return {
			id: definition.id,
			pass: validScore && evidence.length > 0 && score >= definition.min_score,
			score: validScore ? score : null,
			min_score: definition.min_score,
			weight,
			evidence,
			notes: validScore && evidence.length > 0 ? "complete" : "缺少有效 score 或 evidence",
		};
	});
	return { results, score: totalWeight ? roundEven(weighted / totalWeight * 100) : 0 };
}

function checkResult(check: TaskCheckDefinition, pass: boolean, notes: string, evidence: string[] = []): TaskCheckResult {
	return { id: String(check.id), type: String(check.type), required: check.required !== false, pass, notes, evidence };
}

function safeRelative(value: unknown, label: string): string {
	if (!nonEmpty(value) || isAbsolute(String(value)) || String(value).split(/[\\/]/).includes("..")) {
		throw new TaskContractError(`${label} 必须位于 vault 内：${String(value ?? "")}`);
	}
	return String(value).split(sep).join("/");
}

function vaultPath(root: string, value: unknown): string {
	const path = resolve(root, safeRelative(value, "path"));
	if (!inside(path, root)) throw new TaskContractError(`路径越过 vault 边界：${String(value)}`);
	return path;
}

function inside(path: string, root: string): boolean {
	const value = relative(root, path);
	return value === "" || (value !== ".." && !value.startsWith(`..${sep}`));
}

function rel(path: string, root: string): string {
	return relative(root, path).split(sep).join("/");
}

function nestedValue(value: unknown, dotted: string): unknown {
	let current = value;
	for (const part of dotted.split(".")) {
		if (!current || typeof current !== "object" || Array.isArray(current) || !(part in current)) return undefined;
		current = (current as Record<string, unknown>)[part];
	}
	return current;
}

function contains(actual: unknown, expected: unknown): boolean {
	if (typeof actual === "string") return actual.includes(String(expected));
	if (Array.isArray(actual)) return actual.some((item) => deepEqual(item, expected));
	return false;
}

function deepEqual(left: unknown, right: unknown): boolean {
	return stableJson(left) === stableJson(right);
}

function stableJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
	if (value && typeof value === "object") {
		return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
			.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
	}
	return JSON.stringify(value);
}

function roundEven(value: number): number {
	const floor = Math.floor(value);
	const fraction = value - floor;
	if (Math.abs(fraction - 0.5) < Number.EPSILON * 4) return floor % 2 === 0 ? floor : floor + 1;
	return Math.round(value);
}

function nonEmpty(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

function display(value: unknown): string {
	return typeof value === "string" ? `'${value}'` : JSON.stringify(value);
}
