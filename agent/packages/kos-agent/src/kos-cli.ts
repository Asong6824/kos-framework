#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { createObject } from "./kos/operations/create-object.ts";
import { transitionStatus } from "./kos/operations/transition-status.ts";
import { processSource } from "./kos/operations/process-source.ts";
import { updateProject, type UpdateProjectInput } from "./kos/operations/update-project.ts";
import { generateDailyBrief, generateDailyDashboard, generateDiary } from "./kos/operations/daily-workflows.ts";
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

type Values = Map<string, string | true>;

const HELP = `kos-harness - deterministic kos Harness

Usage:
  kos-harness validate [--root <vault>] [--format text|json]
  kos-harness skill-eval [--root <vault>] [--suite <name>] [--write-artifact] [--format text|json]
  kos-harness task-eval --contract <path> [--root <vault>] [--self-assessment <path>] [--state <path>] [--run-id <id>] [--format text|json]
  kos-harness create --kind <kind> --title <title> [--root <vault>] [--directories <json>] [--extra <json>]
  kos-harness transition --path <vault-path> --target <status> [--root <vault>]
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
	const root = vaultRoot(value(values, "root"));
	const format = value(values, "format") ?? "text";
	if (!new Set(["text", "json"]).has(format)) throw new Error("--format must be text or json");

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
		for (const name of ["goal", "priority", "format", "area", "category", "status", "question", "source", "signal-type", "importance", "confidence", "requires-research"]) {
			const raw = values.get(name);
			if (raw !== undefined) extra[name.replaceAll("-", "_")] = raw === true ? true : raw;
		}
		const input: CreateObjectInput = {
			kind,
			title: required(values, "title"),
			directories: value(values, "directories")
				? parseJson(value(values, "directories")!, "--directories") as CreateObjectInput["directories"]
				: {
					project: "30_项目",
					concept: "22_知识库",
					method: "40_方法库",
					task: "31_任务",
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
		const payload = transitionStatus(root, { path: required(values, "path"), target: required(values, "target") });
		print(format, payload, `Transitioned: ${payload.path}\n${payload.from} -> ${payload.to}\nValidation: PASS`);
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

function parseValues(args: string[]): Values {
	const values: Values = new Map();
	for (let index = 0; index < args.length; index++) {
		const arg = args[index];
		if (!arg.startsWith("--")) throw new Error(`Unexpected argument: ${arg}`);
		const name = arg.slice(2);
		const next = args[index + 1];
		if (!next || next.startsWith("--")) values.set(name, true);
		else {
			values.set(name, next);
			index++;
		}
	}
	return values;
}

function value(values: Values, name: string): string | undefined {
	const result = values.get(name);
	return typeof result === "string" ? result : undefined;
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
		project: "30_项目", concept: "22_知识库", method: "40_方法库", task: "31_任务", source: "11_原材料",
	};
}

function timestamp(): string {
	return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

main(process.argv.slice(2)).then(
	(code) => { process.exitCode = code; },
	(error) => {
		const message = error instanceof TaskContractError || error instanceof Error ? error.message : String(error);
		console.error(`kos-harness: ${message}`);
		process.exitCode = 2;
	},
);
