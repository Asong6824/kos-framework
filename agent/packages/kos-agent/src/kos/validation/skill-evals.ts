import { existsSync, readFileSync, readdirSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { parse as parseCsv } from "csv-parse/sync";
import { parse as parseYaml } from "yaml";
import { skillNames } from "./skills.ts";
import type { ValidationFinding, ValidationReport } from "./types.ts";

const REQUIRED_COLUMNS = ["id", "skill", "should_trigger", "prompt", "expected_checks", "notes"];
const CHECKER_IDS = new Set([
	"skill_exists",
	"metadata_scope_core",
	"metadata_scope_integration",
	"metadata_scope_personal",
	"has_external_systems",
	"core_pinned",
	"has_required_sections",
	"mentions_wait_for_transcript",
	"mentions_10_inbox",
	"mentions_11_video",
	"no_legacy_00_inbox",
	"preserves_extend_config",
	"does_not_default_write_kos",
	"has_rules",
	"has_strategies",
	"asks_when_missing_experience",
	"no_fabrication_rule",
	"incubator_promotion_requires_human",
	"promotion_requires_eval",
	"promotion_requires_task_contract",
	"system_check_includes_task_contracts",
	"task_completion_loop",
]);
const CHECK_TYPES = new Set([
	"path_exists",
	"path_not_exists",
	"glob_count",
	"text_contains",
	"text_not_contains",
	"frontmatter",
	"harness_passes",
]);
const CONTRACT_FIELDS = new Set(["version", "id", "skill", "objective", "max_iterations", "checks", "rubric"]);
const CHECK_FIELDS = new Set([
	"id", "type", "required", "path", "pattern", "min", "max", "values", "field", "operator", "expected", "validator", "script",
]);
const RUBRIC_FIELDS = new Set(["id", "description", "min_score", "weight"]);

function relpath(path: string, root: string): string {
	return relative(root, path).split(sep).join("/");
}

function filesUnder(root: string, suffix: string): string[] {
	if (!existsSync(root)) return [];
	const files: string[] = [];
	const visit = (directory: string): void => {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			const path = resolve(directory, entry.name);
			if (entry.isDirectory()) visit(path);
			else if (entry.isFile() && entry.name.endsWith(suffix)) files.push(path);
		}
	};
	visit(root);
	return files.sort();
}

function nonEmpty(value: unknown): boolean {
	return typeof value === "string" && value.trim().length > 0;
}

function safeRelative(value: unknown): boolean {
	if (!nonEmpty(value) || isAbsolute(String(value))) return false;
	return !String(value).split(/[\\/]/).includes("..");
}

function unknownFields(value: Record<string, unknown>, allowed: Set<string>): string[] {
	return Object.keys(value).filter((key) => !allowed.has(key)).sort();
}

export function validateTaskContract(contract: Record<string, unknown>): string[] {
	const errors: string[] = [];
	const unknown = unknownFields(contract, CONTRACT_FIELDS);
	if (unknown.length) errors.push(`未知顶层字段：${JSON.stringify(unknown)}`);
	if (contract.version !== 1 || typeof contract.version === "boolean") errors.push("version 必须为 1");
	for (const field of ["id", "skill", "objective"]) if (!nonEmpty(contract[field])) errors.push(`缺少非空字段 ${field}`);
	const maxIterations = contract.max_iterations ?? 3;
	if (!Number.isInteger(maxIterations) || Number(maxIterations) < 1 || Number(maxIterations) > 10) {
		errors.push("max_iterations 必须是 1 到 10 的整数");
	}
	const checks = Array.isArray(contract.checks) ? contract.checks : [];
	if (checks.length === 0) errors.push("checks 必须是非空数组");
	const checkIds = new Set<string>();
	for (const [index, raw] of checks.entries()) {
		const label = `checks[${index}]`;
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
			errors.push(`${label} 必须是 mapping`);
			continue;
		}
		const check = raw as Record<string, unknown>;
		const unknownCheck = unknownFields(check, CHECK_FIELDS);
		if (unknownCheck.length) errors.push(`${label} 包含未知字段：${JSON.stringify(unknownCheck)}`);
		if (!nonEmpty(check.id)) errors.push(`${label}.id 必须为非空字符串`);
		else if (checkIds.has(String(check.id))) errors.push(`检查 id 重复：${String(check.id)}`);
		else checkIds.add(String(check.id));
		if (!CHECK_TYPES.has(String(check.type))) {
			errors.push(`${label}.type 不受支持：${JSON.stringify(check.type)}`);
			continue;
		}
		if ("required" in check && typeof check.required !== "boolean") errors.push(`${label}.required 必须为布尔值`);
		if (["path_exists", "path_not_exists", "text_contains", "text_not_contains", "frontmatter"].includes(String(check.type)) && !safeRelative(check.path)) {
			errors.push(`${label}.path 必须位于 vault 内`);
		}
		if (check.type === "glob_count") {
			if (!safeRelative(check.pattern)) errors.push(`${label}.pattern 必须位于 vault 内`);
			const minimum = check.min ?? 1;
			if (!Number.isInteger(minimum) || Number(minimum) < 0) errors.push(`${label}.min 必须是非负整数`);
			if (check.max !== undefined && (!Number.isInteger(check.max) || Number(check.max) < Number(minimum))) {
				errors.push(`${label}.max 必须是不小于 min 的整数`);
			}
		}
		if (["text_contains", "text_not_contains"].includes(String(check.type))) {
			if (!Array.isArray(check.values) || check.values.length === 0 || !check.values.every(nonEmpty)) {
				errors.push(`${label}.values 必须是非空字符串数组`);
			}
		}
		if (check.type === "frontmatter") {
			if (!nonEmpty(check.field)) errors.push(`${label}.field 必须为非空字符串`);
			const operator = check.operator ?? "nonempty";
			if (!["nonempty", "equals", "contains"].includes(String(operator))) errors.push(`${label}.operator 不受支持`);
			if (["equals", "contains"].includes(String(operator)) && !("expected" in check)) errors.push(`${label} 必须声明 expected`);
		}
		if (check.type === "harness_passes") {
			const validator = check.validator ?? check.script;
			const supported = ["paths", "schema", "state", "skills", "skill_evals", "yolo", "validate_paths.py", "validate_schema.py", "validate_state.py", "validate_permissions.py", "validate_skills.py", "validate_skill_evals.py"];
			if (!nonEmpty(validator) || !supported.includes(String(validator))) errors.push(`${label}.validator 不受支持`);
		}
	}
	const rubric = contract.rubric ?? [];
	if (!Array.isArray(rubric)) errors.push("rubric 必须是数组");
	else {
		const rubricIds = new Set<string>();
		for (const [index, raw] of rubric.entries()) {
			const label = `rubric[${index}]`;
			if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
				errors.push(`${label} 必须是 mapping`);
				continue;
			}
			const item = raw as Record<string, unknown>;
			const unknownRubric = unknownFields(item, RUBRIC_FIELDS);
			if (unknownRubric.length) errors.push(`${label} 包含未知字段：${JSON.stringify(unknownRubric)}`);
			if (!nonEmpty(item.id)) errors.push(`${label}.id 必须为非空字符串`);
			else if (rubricIds.has(String(item.id))) errors.push(`rubric id 重复：${String(item.id)}`);
			else rubricIds.add(String(item.id));
			if (!nonEmpty(item.description)) errors.push(`${label}.description 必须为非空字符串`);
			if (typeof item.min_score !== "number" || item.min_score < 0 || item.min_score > 4) errors.push(`${label}.min_score 必须在 0 到 4 之间`);
			if (item.weight !== undefined && (typeof item.weight !== "number" || item.weight <= 0)) errors.push(`${label}.weight 必须大于 0`);
		}
	}
	return errors;
}

function report(root: string, files: string[], findings: ValidationFinding[]): ValidationReport {
	const errorCount = findings.filter((item) => item.level === "ERROR").length;
	const warningCount = findings.filter((item) => item.level === "WARN").length;
	return { root, validatedPaths: files.map((file) => relpath(file, root)), findings, errorCount, warningCount, passed: errorCount === 0 };
}

export function validateSkillEvals(root: string): ValidationReport {
	const resolvedRoot = resolve(root);
	const evalRoot = resolve(resolvedRoot, "90_系统/evals");
	const skillDir = resolve(evalRoot, "skills");
	const contractDir = resolve(evalRoot, "contracts");
	const findings: ValidationFinding[] = [];
	const add = (level: ValidationFinding["level"], path: string, message: string): void => {
		findings.push({ level, validator: "skill_evals", path, message });
	};
	for (const [path, label] of [[evalRoot, "Skill eval 根目录"], [skillDir, "skills prompt 目录"], [contractDir, "Task Contract 目录"]] as const) {
		if (!existsSync(path)) add("ERROR", relpath(path, resolvedRoot), `缺少 ${label}`);
	}
	const files: string[] = [];
	const availableSkills = skillNames(resolvedRoot);
	const csvFiles = filesUnder(skillDir, ".prompts.csv");
	files.push(...csvFiles);
	for (const path of csvFiles) {
		const rel = relpath(path, resolvedRoot);
		let rows: string[][];
		try {
			rows = parseCsv(readFileSync(path, "utf8"), { bom: true, skip_empty_lines: true, relax_column_count: false }) as string[][];
		} catch (error) {
			add("ERROR", rel, `CSV 无法解析：${error instanceof Error ? error.message : String(error)}`);
			continue;
		}
		if (JSON.stringify(rows[0] ?? []) !== JSON.stringify(REQUIRED_COLUMNS)) {
			add("ERROR", rel, `CSV 表头必须为 ${JSON.stringify(REQUIRED_COLUMNS)}`);
			continue;
		}
		for (const [index, row] of rows.slice(1).entries()) {
			const record = Object.fromEntries(REQUIRED_COLUMNS.map((column, columnIndex) => [column, row[columnIndex] ?? ""]));
			const id = record.id || `<row-${index + 2}>`;
			if (!["true", "false"].includes(record.should_trigger.trim().toLowerCase())) add("ERROR", rel, `${id}: should_trigger 必须为 true/false`);
			if (!record.skill.trim()) add("ERROR", rel, `${id}: 缺少 skill`);
			else if (!availableSkills.has(record.skill.trim())) add("ERROR", rel, `${id}: 目标 Skill 不存在：${record.skill.trim()}`);
			if (!record.prompt.trim()) add("ERROR", rel, `${id}: 缺少 prompt`);
			const checks = record.expected_checks.split("|").map((item) => item.trim()).filter(Boolean);
			if (checks.length === 0) add("ERROR", rel, `${id}: 缺少 expected_checks`);
			for (const check of checks) if (!CHECKER_IDS.has(check)) add("ERROR", rel, `${id}: 未知检查项 \`${check}\``);
		}
	}

	const contractFiles = filesUnder(contractDir, ".task.yaml");
	files.push(...contractFiles);
	const contractIds = new Set<string>();
	for (const path of contractFiles) {
		const rel = relpath(path, resolvedRoot);
		let contract: unknown;
		try {
			contract = parseYaml(readFileSync(path, "utf8"));
		} catch (error) {
			add("ERROR", rel, `Task Contract YAML 无法解析：${error instanceof Error ? error.message : String(error)}`);
			continue;
		}
		if (!contract || typeof contract !== "object" || Array.isArray(contract)) {
			add("ERROR", rel, "Task Contract 必须是 mapping");
			continue;
		}
		const value = contract as Record<string, unknown>;
		for (const error of validateTaskContract(value)) add("ERROR", rel, `Task Contract 非法：${error}`);
		if (nonEmpty(value.id)) {
			if (contractIds.has(String(value.id))) add("ERROR", rel, `Task Contract id 重复：${String(value.id)}`);
			contractIds.add(String(value.id));
		}
		if (nonEmpty(value.skill) && !availableSkills.has(String(value.skill))) add("ERROR", rel, `目标 Skill 不存在：${String(value.skill)}`);
	}
	return report(resolvedRoot, files, findings);
}
