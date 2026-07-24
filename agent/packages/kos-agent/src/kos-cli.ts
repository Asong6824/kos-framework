#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createObject } from "./kos/operations/create-object.ts";
import { transitionStatus } from "./kos/operations/transition-status.ts";
import { setGoalWeights } from "./kos/operations/set-goal-weights.ts";
import { reviewGoalHealth, updateGoal } from "./kos/operations/goal-management.ts";
import { archiveTask, completeTask, deferTask, listTaskPool, returnTaskToPool, updateTask } from "./kos/operations/task-pool.ts";
import { processSource } from "./kos/operations/process-source.ts";
import { updateProject, type UpdateProjectInput } from "./kos/operations/update-project.ts";
import { generateDailyBrief, generateDailyDashboard, generateDiary } from "./kos/operations/daily-workflows.ts";
import { endDay, migrateTaskPool, recordRecommendationFeedback, reviewMonth, reviewWeek, saveDailyPlan, startDay } from "./kos/operations/progress-workflows.ts";
import { migrateLayout } from "./kos/operations/layout-migration.ts";
import { migrateProjectDirectories } from "./kos/operations/project-directories.ts";
import type { CreateObjectInput } from "./kos/operations/types.ts";
import { runSkillEvals } from "./kos/evals/skill-evals.ts";
import {
	evaluateTaskContract,
	loadSelfAssessment,
	loadTaskContract,
	TaskContractError,
	updateTaskRunState,
	type TaskRunState,
} from "./kos/evals/task-contract.ts";
import { validateSkillEvals } from "./kos/validation/skill-evals.ts";
import { validateSkills } from "./kos/validation/skills.ts";
import { findVaultRoot, validateVault } from "./kos/validation/validate.ts";
import type { ValidationFinding, ValidationReport } from "./kos/validation/types.ts";

type Values = Map<string, string | string[] | true>;

const COMMON_OPTIONS = ["root", "format"] as const;
const CREATE_OPTIONS = [
	"kind", "title", "directories", "extra", "dry-run", "period", "allocation-weight", "health", "expected-result", "not-doing",
	"status", "category", "priority", "area", "goal", "why", "current-stage", "due", "problem", "success", "constraint", "task", "note",
	"definition", "importance", "understanding", "example", "pitfall", "scenario", "not-scenario", "prerequisite", "step", "criteria", "validation",
	"source", "source-url", "source-location", "source-name", "source-diary", "source-project", "source-reflection",
	"related", "related-source", "related-research", "related-project", "related-concept", "related-method", "related-reflection", "related-topic",
	"alias", "tag", "question", "background", "trigger", "concept-candidate", "format", "signal-type", "topic", "fact", "interpretation", "impact",
	"confidence", "requires-research", "keyword", "next", "ticker", "market", "business", "metric",
	"conclusion", "evidence", "applies-to", "not-applies-to", "applies-to-skill", "collaboration-preference",
	"high-energy-task", "low-energy-task", "blind-spot", "agent-guideline", "hypothesis", "rejected-belief", "previous-view", "changed-view", "reason", "to-verify",
	"primary-goal", "supporting-goal", "goal-alignment", "alignment-reason", "alignment-reviewed", "exploration-review-due", "process-metric", "result-metric", "next-milestone",
	"project", "projects", "scheduled-for", "defer-until", "estimate-minutes", "energy", "work-mode", "growth-mode", "scheduled-time",
] as const;
const LIST_CREATE_OPTIONS = new Set([
	"problem", "success", "constraint", "task", "example", "pitfall", "scenario", "not-scenario", "prerequisite", "step", "criteria", "validation",
	"source", "source-project", "source-reflection", "related", "related-source", "related-research", "related-project", "related-concept", "related-method",
	"related-reflection", "related-topic", "alias", "tag", "concept-candidate", "topic", "keyword", "fact", "interpretation", "impact", "metric", "question",
	"conclusion", "evidence", "applies-to", "not-applies-to", "applies-to-skill", "collaboration-preference", "high-energy-task", "low-energy-task",
	"blind-spot", "agent-guideline", "hypothesis", "rejected-belief", "to-verify", "metric", "not-doing", "supporting-goal", "process-metric", "result-metric",
	"project", "projects", "scheduled-time",
]);

const HELP = `kos-harness - deterministic kos Harness

Usage:
  kos-harness validate [--root <vault>] [--format text|json]
  kos-harness skill-eval [--root <vault>] [--suite <name>] [--write-artifact] [--format text|json]
  kos-harness task-eval --contract <path> [--root <vault>] [--self-assessment <path>] [--state <path>] [--run-id <id>] [--format text|json]
  kos-harness create --kind <kind> --title <title> [--root <vault>] [--directories <json>] [--extra <json>] [--output-format text|json]
  kos-harness transition --path <vault-path> --target <status> [--human-confirmed] [--root <vault>]
  kos-harness set-goal-weights --input <json> [--root <vault>]
  kos-harness update-goal --input <json> [--root <vault>]
  kos-harness review-goal-health --path <goal> [--date YYYY-MM-DD] [--root <vault>]
  kos-harness update-task --input <json> [--root <vault>]
  kos-harness list-task-pool [--today YYYY-MM-DD] [--root <vault>]
  kos-harness defer-task --input <json> [--root <vault>]
  kos-harness return-task-to-pool --input <json> [--root <vault>]
  kos-harness complete-task --input <json> [--root <vault>]
  kos-harness archive-task --input <json> [--root <vault>]
  kos-harness migrate-task-pool [--dry-run] [--root <vault>]
  kos-harness migrate-layout [--dry-run] [--root <vault>]
  kos-harness migrate-project-directories [--dry-run] [--root <vault>]
  kos-harness start-day [--input <json>] [--root <vault>]
  kos-harness save-daily-plan --input <json> [--root <vault>]
  kos-harness recommendation-feedback --input <json> [--root <vault>]
  kos-harness end-day [--date YYYY-MM-DD] [--root <vault>]
  kos-harness review-week [--date YYYY-MM-DD] [--root <vault>]
  kos-harness review-month [--date YYYY-MM-DD] [--root <vault>]
  kos-harness process-source --kind extract|summary [--query <source>] [--root <vault>]
  kos-harness update-project [--query <project>] --input <json> [--root <vault>]
  kos-harness daily-dashboard [--root <vault>]
  kos-harness daily-brief [--root <vault>]
  kos-harness diary [--root <vault>]

All mutating commands run in YOLO mode. They do not request approval.`;

async function main(argv: string[]): Promise<number> {
	const command = argv[0];
	if (!command || command === "help" || command === "--help" || command === "-h") {
		console.log(HELP);
		return 0;
	}
	const values = parseValues(argv.slice(1));
	assertAllowed(values, allowedOptions(command));
	const root = vaultRoot(value(values, "root"));
	const formatOption = command === "create" ? "output-format" : "format";
	const format = value(values, formatOption) ?? "text";
	if (!new Set(["text", "json"]).has(format)) throw new Error(`--${formatOption} must be text or json`);

	if (command === "validate") {
		const reports = [validateVault(root), validateSkills(root), validateSkillEvals(root)];
		const payload = mergeReports(root, reports);
		print(format, payload, formatValidation(payload));
		return payload.passed ? 0 : 1;
	}
	if (command === "skill-eval") {
		const payload = runSkillEvals(root, {
			suite: value(values, "suite"),
			writeArtifact: values.has("write-artifact"),
		});
		print(format, payload, formatSkillEval(payload));
		return payload.overall_pass ? 0 : payload.case_count ? 1 : 2;
	}
	if (command === "task-eval") {
		const contractValue = required(values, "contract");
		const contractPath = resolveContract(root, contractValue);
		const assessmentPath = value(values, "self-assessment");
		const stateValue = value(values, "state");
		const statePath = stateValue ? resolve(stateValue) : undefined;
		const previous = statePath && existsSync(statePath)
			? JSON.parse(readFileSync(statePath, "utf8")) as TaskRunState
			: undefined;
		const contract = loadTaskContract(contractPath);
		const assessment = loadSelfAssessment(assessmentPath ? resolve(assessmentPath) : undefined);
		const iteration = (previous?.attempts.length ?? 0) + 1;
		const runId = value(values, "run-id") ?? previous?.run_id ?? `${contract.id}-${timestamp()}`;
		const attempt = evaluateTaskContract(root, contract, assessment, iteration);
		const payload = updateTaskRunState(previous, contract, attempt, runId);
		if (statePath) {
			mkdirSync(dirname(statePath), { recursive: true });
			writeFileSync(statePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
		}
		print(format, payload, formatTaskEval(payload, statePath));
		return payload.status === "pass" ? 0 : 1;
	}
	if (command === "create") {
		const kind = required(values, "kind") as CreateObjectInput["kind"];
		const extra = value(values, "extra")
			? parseJson(value(values, "extra")!, "--extra") as NonNullable<CreateObjectInput["extra"]>
			: {};
		for (const name of CREATE_OPTIONS) {
			if (["kind", "title", "directories", "extra", "dry-run"].includes(name)) continue;
			const raw = values.get(name);
			if (raw === undefined) continue;
			const normalized = name.replaceAll("-", "_");
			extra[normalized] = LIST_CREATE_OPTIONS.has(name) ? valuesOf(values, name) : raw === true ? true : value(values, name);
		}
		const input: CreateObjectInput = {
			kind,
			title: required(values, "title"),
			directories: value(values, "directories")
				? parseJson(value(values, "directories")!, "--directories") as CreateObjectInput["directories"]
				: {
					project: "31_项目",
					concept: "22_知识库",
					method: "23_方法库",
					task: "32_任务",
					source: "11_原材料",
				},
			extra,
			dryRun: values.has("dry-run"),
		};
		const payload = createObject(root, input);
		print(format, payload, `${input.dryRun ? "Preview" : "Created"}: ${payload.path}\nValidation: PASS`);
		return 0;
	}
	if (command === "transition") {
		const payload = transitionStatus(root, {
			path: required(values, "path"),
			target: required(values, "target"),
			humanConfirmed: values.has("human-confirmed"),
		});
		print(format, payload, `Transitioned: ${payload.path}\n${payload.from} -> ${payload.to}\nValidation: PASS`);
		return 0;
	}
	if (command === "set-goal-weights") {
		const input = parseJson(required(values, "input"), "--input") as Parameters<typeof setGoalWeights>[1];
		const payload = setGoalWeights(root, input);
		print(format, payload, `Updated Goal allocation: ${payload.period}\nActive total: ${payload.activeTotal}\nValidation: PASS`);
		return 0;
	}
	if (command === "update-goal") {
		const payload = updateGoal(root, parseJson(required(values, "input"), "--input") as Parameters<typeof updateGoal>[1]);
		print(format, payload, `Updated Goal: ${payload.path}\nValidation: PASS`);
		return 0;
	}
	if (command === "review-goal-health") {
		const payload = reviewGoalHealth(root, required(values, "path"), value(values, "date"));
		print(format, payload, `Goal health suggestion: ${payload.current} -> ${payload.suggested}\n${payload.reasons.join("\n")}`);
		return 0;
	}
	if (["update-task", "defer-task", "return-task-to-pool", "complete-task", "archive-task"].includes(command)) {
		const input = parseJson(required(values, "input"), "--input") as never;
		const operation = command === "update-task" ? updateTask : command === "defer-task" ? deferTask : command === "return-task-to-pool" ? returnTaskToPool : command === "archive-task" ? archiveTask : completeTask;
		const payload = operation(root, input);
		print(format, payload, `${command}: ${payload.path}\nValidation: PASS`);
		return 0;
	}
	if (command === "list-task-pool") {
		const payload = listTaskPool(root, value(values, "today"));
		print(format, payload, JSON.stringify(payload, null, 2));
		return 0;
	}
	if (command === "migrate-task-pool") {
		const payload = migrateTaskPool(root, values.has("dry-run"));
		print(format, payload, `${values.has("dry-run") ? "Task migration preview" : "Task migration complete"}: ${payload.changedPaths.length}/${payload.scanned}`);
		return 0;
	}
	if (command === "migrate-layout") {
		const payload = migrateLayout(root, values.has("dry-run"));
		const moveCount = payload.moves.filter((move) => move.state === "move").length;
		print(format, payload, `${values.has("dry-run") ? "Layout migration preview" : "Layout migration complete"}: ${moveCount} directories, ${payload.rewrittenPaths.length} references${payload.backupPath ? `\nBackup: ${payload.backupPath}` : ""}`);
		return payload.conflicts.length ? 1 : 0;
	}
	if (command === "migrate-project-directories") {
		const payload = migrateProjectDirectories(root, values.has("dry-run"));
		print(format, payload, `${values.has("dry-run") ? "Project directory migration preview" : "Project directory migration complete"}: ${payload.moves.filter((move) => move.state === "move").length}/${payload.scanned}`);
		return payload.conflicts.length ? 1 : 0;
	}
	if (command === "start-day") {
		const input = value(values, "input") ? parseJson(value(values, "input")!, "--input") as Parameters<typeof startDay>[1] : {};
		const payload = startDay(root, input);
		print(format, payload, `Started day context: ${payload.context.date}\nDeterministic candidates: ${payload.recommendations.length}\nPlan: ${payload.path}`);
		return 0;
	}
	if (command === "save-daily-plan") {
		const payload = saveDailyPlan(root, parseJson(required(values, "input"), "--input") as Parameters<typeof saveDailyPlan>[1]);
		print(format, payload, `Saved LLM daily plan: ${payload.path}`);
		return 0;
	}
	if (command === "recommendation-feedback") {
		const payload = recordRecommendationFeedback(root, parseJson(required(values, "input"), "--input") as Parameters<typeof recordRecommendationFeedback>[1]);
		print(format, payload, `Recommendation feedback recorded: ${payload.path}`);
		return 0;
	}
	if (["end-day", "review-week", "review-month"].includes(command)) {
		const operation = command === "end-day" ? endDay : command === "review-week" ? reviewWeek : reviewMonth;
		const payload = operation(root, value(values, "date"));
		print(format, payload, `Generated: ${payload.path}\nPeriod: ${payload.period}`);
		return 0;
	}
	if (command === "process-source") {
		const kind = required(values, "kind");
		if (kind !== "extract" && kind !== "summary") throw new Error("--kind must be extract or summary");
		const payload = processSource(root, {
			kind,
			query: value(values, "query"),
			location: value(values, "location"),
			directories: defaultDirectories(),
			dryRun: values.has("dry-run"),
		});
		print(format, payload, `${values.has("dry-run") ? "Preview" : "Created"}: ${payload.path}${values.has("dry-run") ? "" : "\nSource backlink updated"}\nValidation: PASS`);
		return 0;
	}
	if (command === "update-project") {
		const input = value(values, "input")
			? parseJson(value(values, "input")!, "--input") as UpdateProjectInput
			: {};
		if (value(values, "query")) input.query = value(values, "query");
		if (value(values, "status")) input.status = value(values, "status");
		if (value(values, "current-stage")) input.currentStage = value(values, "current-stage");
		for (const [flag, field] of [["progress", "progress"], ["task", "tasks"], ["decision", "decisions"], ["review", "reviews"], ["problem", "problems"], ["final-result", "finalResults"], ["final-insight", "finalInsights"]] as const) {
			const item = value(values, flag);
			if (item) (input[field] as string[] | undefined) = [item];
		}
		const payload = updateProject(root, input);
		print(format, payload, `Updated: ${payload.path}\nValidation: PASS`);
		return 0;
	}
	if (["daily-dashboard", "daily-brief", "diary"].includes(command)) {
		const payload = command === "daily-dashboard"
			? generateDailyDashboard(root)
			: command === "daily-brief"
				? generateDailyBrief(root)
				: generateDiary(root);
		print(format, payload, `Generated: ${payload.path}\nValidation: PASS`);
		return 0;
	}
	throw new Error(`Unknown command: ${command}\n\n${HELP}`);
}

export function parseValues(args: string[]): Values {
	const values: Values = new Map();
	for (let index = 0; index < args.length; index++) {
		const arg = args[index];
		if (!arg.startsWith("--")) throw new Error(`Unexpected argument: ${arg}`);
		const name = arg.slice(2);
		const next = args[index + 1];
		if (!next || next.startsWith("--")) values.set(name, true);
		else {
			const previous = values.get(name);
			if (previous === undefined || previous === true) values.set(name, previous === true ? ["true", next] : next);
			else values.set(name, Array.isArray(previous) ? [...previous, next] : [previous, next]);
			index++;
		}
	}
	return values;
}

function value(values: Values, name: string): string | undefined {
	const result = values.get(name);
	return typeof result === "string" ? result : Array.isArray(result) ? result.at(-1) : undefined;
}

function valuesOf(values: Values, name: string): string[] {
	const result = values.get(name);
	return typeof result === "string" ? [result] : Array.isArray(result) ? result : [];
}

export function allowedOptions(command: string): ReadonlySet<string> {
	const byCommand: Record<string, readonly string[]> = {
		validate: COMMON_OPTIONS,
		"skill-eval": [...COMMON_OPTIONS, "suite", "write-artifact"],
		"task-eval": [...COMMON_OPTIONS, "contract", "self-assessment", "state", "run-id"],
		create: [...COMMON_OPTIONS, ...CREATE_OPTIONS, "output-format"],
		transition: [...COMMON_OPTIONS, "path", "target", "human-confirmed"],
		"set-goal-weights": [...COMMON_OPTIONS, "input"],
		"update-goal": [...COMMON_OPTIONS, "input"],
		"review-goal-health": [...COMMON_OPTIONS, "path", "date"],
		"update-task": [...COMMON_OPTIONS, "input"],
		"list-task-pool": [...COMMON_OPTIONS, "today"],
		"defer-task": [...COMMON_OPTIONS, "input"],
		"return-task-to-pool": [...COMMON_OPTIONS, "input"],
		"complete-task": [...COMMON_OPTIONS, "input"],
		"archive-task": [...COMMON_OPTIONS, "input"],
		"migrate-task-pool": [...COMMON_OPTIONS, "dry-run"],
		"migrate-layout": [...COMMON_OPTIONS, "dry-run"],
		"migrate-project-directories": [...COMMON_OPTIONS, "dry-run"],
		"start-day": [...COMMON_OPTIONS, "input"],
		"save-daily-plan": [...COMMON_OPTIONS, "input"],
		"recommendation-feedback": [...COMMON_OPTIONS, "input"],
		"end-day": [...COMMON_OPTIONS, "date"],
		"review-week": [...COMMON_OPTIONS, "date"],
		"review-month": [...COMMON_OPTIONS, "date"],
		"process-source": [...COMMON_OPTIONS, "kind", "query", "location", "dry-run"],
		"update-project": [...COMMON_OPTIONS, "query", "input", "status", "current-stage", "progress", "task", "decision", "review", "problem", "final-result", "final-insight"],
		"daily-dashboard": COMMON_OPTIONS,
		"daily-brief": COMMON_OPTIONS,
		diary: COMMON_OPTIONS,
	};
	return new Set(byCommand[command] ?? COMMON_OPTIONS);
}

export function assertAllowed(values: Values, allowed: ReadonlySet<string>): void {
	const unknown = [...values.keys()].filter((name) => !allowed.has(name));
	if (unknown.length) throw new Error(`Unknown option${unknown.length > 1 ? "s" : ""}: ${unknown.map((name) => `--${name}`).join(", ")}`);
}

function required(values: Values, name: string): string {
	const result = value(values, name);
	if (!result) throw new Error(`Missing required --${name}`);
	return result;
}

function vaultRoot(input?: string): string {
	const root = input ? resolve(input) : findVaultRoot(process.cwd());
	if (!root) throw new Error("Cannot find kos Vault root; pass --root explicitly");
	if (!existsSync(resolve(root, ".kos.md")) && !existsSync(resolve(root, ".hermes.md"))) {
		throw new Error(`Not a kos Vault: ${root}`);
	}
	return root;
}

function resolveContract(root: string, input: string): string {
	if (isAbsolute(input)) return input;
	const direct = resolve(input);
	if (existsSync(direct)) return direct;
	const name = input.endsWith(".task.yaml") ? input : `${input}.task.yaml`;
	return resolve(root, "90_系统/evals/contracts", name);
}

function mergeReports(root: string, reports: ValidationReport[]): ValidationReport {
	const findings = reports.flatMap((report) => report.findings);
	return {
		root,
		validatedPaths: [...new Set(reports.flatMap((report) => report.validatedPaths))].sort(),
		findings,
		errorCount: findings.filter((finding) => finding.level === "ERROR").length,
		warningCount: findings.filter((finding) => finding.level === "WARN").length,
		passed: findings.every((finding) => finding.level !== "ERROR"),
	};
}

function formatValidation(report: ValidationReport): string {
	const lines = [
		`Harness: ${report.passed ? "PASS" : "FAIL"}`,
		`Errors: ${report.errorCount}`,
		`Warnings: ${report.warningCount}`,
	];
	for (const finding of report.findings) lines.push(formatFinding(finding));
	return lines.join("\n");
}

function formatFinding(finding: ValidationFinding): string {
	return `[${finding.level}] ${finding.validator} ${finding.path}: ${finding.message}`;
}

function formatSkillEval(payload: ReturnType<typeof runSkillEvals>): string {
	const lines = [
		`Skill Eval: ${payload.suite}`,
		`Overall: ${payload.status.toUpperCase()}`,
		`Score: ${payload.score}`,
		`Cases: ${payload.case_count}`,
	];
	if (!payload.results.length) lines.push("No runtime Skill eval cases are currently defined");
	for (const result of payload.results) {
		lines.push(`- [${result.pass ? "PASS" : "FAIL"}] ${result.id} (${result.skill})`);
		for (const check of result.checks.filter((check) => !check.pass)) lines.push(`  - FAIL ${check.id}: ${check.notes}`);
	}
	if (payload.artifact) lines.push(`Artifact: ${payload.artifact}`);
	return lines.join("\n");
}

function formatTaskEval(payload: TaskRunState, statePath?: string): string {
	const latest = payload.attempts.at(-1)!;
	const lines = [
		`Task Contract: ${payload.contract_id}`,
		`Status: ${payload.status.toUpperCase()}`,
		`Iteration: ${payload.metrics.iterations}/${payload.max_iterations}`,
		`Score: ${latest.score}`,
		`pass@1: ${payload.metrics.pass_at_1}`,
		`pass@k: ${payload.metrics.pass_at_k}`,
		...latest.failures.map((failure) => `- FAIL ${failure}`),
	];
	if (latest.next_action) lines.push(`Next action: ${latest.next_action}`);
	if (statePath) lines.push(`State: ${statePath}`);
	return lines.join("\n");
}

function print(format: string, payload: unknown, text: string): void {
	console.log(format === "json" ? JSON.stringify(payload, null, 2) : text);
}

function parseJson(input: string, name: string): unknown {
	try {
		return JSON.parse(input);
	} catch (error) {
		throw new Error(`${name} must be valid JSON: ${error instanceof Error ? error.message : String(error)}`);
	}
}

function defaultDirectories(): CreateObjectInput["directories"] {
	return {
		project: "31_项目", concept: "22_知识库", method: "23_方法库", task: "32_任务", source: "11_原材料",
	};
}

function timestamp(): string {
	return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	main(process.argv.slice(2)).then(
		(code) => { process.exitCode = code; },
		(error) => {
			const message = error instanceof TaskContractError || error instanceof Error ? error.message : String(error);
			console.error(`kos-harness: ${message}`);
			process.exitCode = 2;
		},
	);
}
