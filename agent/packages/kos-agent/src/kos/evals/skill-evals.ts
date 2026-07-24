import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { parse as parseCsv } from "csv-parse/sync";
import { parseFrontmatterFile } from "../validation/frontmatter.ts";

export interface SkillEvalCase {
	id: string;
	skill: string;
	should_trigger: boolean;
	prompt: string;
	expected_checks: string[];
	notes: string;
	source_file: string;
}

export interface SkillEvalCheckResult {
	id: string;
	pass: boolean;
	notes: string;
}

export interface SkillEvalCaseResult {
	id: string;
	skill: string;
	suite: string;
	should_trigger: boolean;
	prompt: string;
	pass: boolean;
	checks: SkillEvalCheckResult[];
	notes: string;
}

export interface SkillEvalResult {
	kind: "skill_contract_eval";
	created: string;
	suite: string;
	status: "pass" | "fail" | "no_cases";
	overall_pass: boolean;
	score: number;
	case_count: number;
	check_count: number;
	results: SkillEvalCaseResult[];
	artifact?: string;
}

export interface RunSkillEvalsOptions {
	suite?: string;
	writeArtifact?: boolean;
	now?: Date;
}

interface SkillDocument {
	path?: string;
	frontmatter: Record<string, unknown>;
	body: string;
}

type Checker = (evalCase: SkillEvalCase) => SkillEvalCheckResult;

export function loadSkillEvalCases(root: string, suite?: string): SkillEvalCase[] {
	const skillDir = resolve(root, "90_系统/evals/skills");
	if (!existsSync(skillDir)) return [];
	let files = readdirSync(skillDir, { withFileTypes: true })
		.filter((entry) => entry.isFile() && entry.name.endsWith(".prompts.csv"))
		.map((entry) => resolve(skillDir, entry.name))
		.sort();
	if (suite) {
		const name = suite.endsWith(".csv") ? suite : `${suite}.prompts.csv`;
		const target = resolve(skillDir, name);
		files = existsSync(target) ? [target] : [];
	}
	return files.flatMap((path) => {
		const records = parseCsv(readFileSync(path, "utf8"), {
			columns: true,
			skip_empty_lines: true,
			bom: true,
			trim: false,
		}) as Array<Record<string, string | undefined>>;
		return records.map((row): SkillEvalCase => ({
			id: (row.id ?? "").trim(),
			skill: (row.skill ?? "").trim(),
			should_trigger: (row.should_trigger ?? "").trim().toLowerCase() === "true",
			prompt: row.prompt ?? "",
			expected_checks: (row.expected_checks ?? "").split("|").map((item) => item.trim()).filter(Boolean),
			notes: row.notes ?? "",
			source_file: path,
		}));
	});
}

export function runSkillEvals(root: string, options: RunSkillEvalsOptions = {}): SkillEvalResult {
	const resolvedRoot = resolve(root);
	const cases = loadSkillEvalCases(resolvedRoot, options.suite);
	const checkers = buildCheckers(resolvedRoot);
	let totalChecks = 0;
	let passedChecks = 0;
	const results = cases.map((evalCase): SkillEvalCaseResult => {
		const checks = evalCase.expected_checks.map((id) => {
			const checker = checkers.get(id);
			const result = checker
				? checker(evalCase)
				: { id, pass: false, notes: `未知检查器：${id}` };
			totalChecks++;
			if (result.pass) passedChecks++;
			return result;
		});
		return {
			id: evalCase.id,
			skill: evalCase.skill,
			suite: basename(evalCase.source_file),
			should_trigger: evalCase.should_trigger,
			prompt: evalCase.prompt,
			pass: checks.every((check) => check.pass),
			checks,
			notes: evalCase.notes,
		};
	});
	const overallPass = results.length > 0 && results.every((result) => result.pass);
	const date = localDate(options.now ?? new Date());
	const payload: SkillEvalResult = {
		kind: "skill_contract_eval",
		created: date,
		suite: options.suite ?? "all",
		status: overallPass ? "pass" : results.length ? "fail" : "no_cases",
		overall_pass: overallPass,
		score: totalChecks ? roundEven(passedChecks / totalChecks * 100) : 0,
		case_count: results.length,
		check_count: totalChecks,
		results,
	};
	if (options.writeArtifact) {
		const outputDir = resolve(resolvedRoot, "90_系统/evals/artifacts");
		mkdirSync(outputDir, { recursive: true });
		const name = (options.suite ?? "all").replaceAll("/", "_").replace(/\.prompts\.csv$/, "");
		const path = join(outputDir, `${date}_${name}.json`);
		writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
		payload.artifact = path;
	}
	return payload;
}

function buildCheckers(root: string): Map<string, Checker> {
	const documents = skillDocuments(root);
	const readSkill = (name: string): SkillDocument => documents.get(name) ?? { frontmatter: {}, body: "" };
	const result = (id: string, pass: boolean, notes: string): SkillEvalCheckResult => ({ id, pass, notes });
	const metadataScope = (scope: string): Checker => (evalCase) => {
		const actual = nestedGet(readSkill(evalCase.skill).frontmatter, "metadata", "kos", "scope");
		return result(`metadata_scope_${scope}`, actual === scope, `scope=${display(actual)}`);
	};
	const bodyContains = (id: string, fragments: string[]): Checker => (evalCase) => {
		const pass = fragments.every((fragment) => readSkill(evalCase.skill).body.includes(fragment));
		return result(id, pass, fragments.join(" / "));
	};
	const childExists = (id: string, parts: string[]): Checker => (evalCase) => {
		const skill = readSkill(evalCase.skill);
		const target = skill.path ? resolve(skill.path, "..", ...parts) : undefined;
		return result(id, target !== undefined && existsSync(target), target ?? "Skill 不存在");
	};
	const checks = new Map<string, Checker>();
	checks.set("skill_exists", (evalCase) => {
		const path = readSkill(evalCase.skill).path;
		return result("skill_exists", path !== undefined, path ?? "Skill 不存在");
	});
	for (const scope of ["core", "integration", "personal"]) checks.set(`metadata_scope_${scope}`, metadataScope(scope));
	checks.set("has_external_systems", (evalCase) => {
		const systems = nestedGet(readSkill(evalCase.skill).frontmatter, "metadata", "kos", "external_systems");
		return result("has_external_systems", Array.isArray(systems) && systems.length > 0, `external_systems=${display(systems)}`);
	});
	checks.set("core_pinned", (evalCase) => {
		const pinned = nestedGet(readSkill(evalCase.skill).frontmatter, "metadata", "hermes", "pinned");
		return result("core_pinned", pinned === true, `pinned=${display(pinned)}`);
	});
	checks.set("has_required_sections", (evalCase) => {
		const body = readSkill(evalCase.skill).body;
		const sections = ["## When to Use", "## Prerequisites", "## How to Run", "## Quick Reference", "## Procedure", "## Pitfalls", "## Verification"];
		const missing = sections.filter((section) => !body.includes(section));
		return result("has_required_sections", missing.length === 0, missing.length ? `missing=${JSON.stringify(missing)}` : "complete");
	});
	const bodyChecks: Record<string, string[]> = {
		mentions_wait_for_transcript: ["等待转录确认"],
		mentions_10_inbox: ["10_收件箱"],
		mentions_11_video: ["11_原材料/视频"],
		no_legacy_00_inbox: ["不要写入 `00_收件箱/`"],
		does_not_default_write_kos: ["默认不", "写入 kos"],
		asks_when_missing_experience: ["素材不足", "先询问"],
		no_fabrication_rule: ["不可虚构"],
		incubator_promotion_requires_human: ["用户明确确认", "晋升"],
		promotion_requires_eval: ["eval", "晋升"],
		promotion_requires_task_contract: ["evals/contracts", "最大迭代次数"],
		system_check_includes_task_contracts: ["90_系统/evals/contracts"],
		task_completion_loop: ["Task Contract", "pass@1", "pass@k", "最大迭代"],
		goal_planning_contract: ["H1/H2", "allocation_weight", "合计 100", "用户确认"],
		daily_planning_contract: ["PlanningContext", "save-daily-plan", "LLM", "defer_until", "recommended", "accepted", "adjusted", "deferred", "rejected", "最多三项"],
		period_review_contract: ["review-week", "review-month", "off_goal", "投入偏差", "不自动修改"],
		capability_focus_contract: ["capability_focus", "applies_to", "max_daily_recommendations", "最多一个"],
			project_alignment_contract: ["direct", "enabling", "exploratory", "off_goal", "conflicting", "过程指标", "结果指标"],
			task_management_contract: ["list-task-pool", "update-task", "defer-task", "complete-task", "Project 贡献", "ask_question"],
			source_processing_contract: ["captured", "extracted", "summarized", "reviewed", "linked", "archived", "ask_question", "不能由 Agent 自己确认"],
			object_revision_contract: ["ask_question", "退回原因", "原位修订", "保持待审状态", "不把修订后的对象自动标记"],
	};
	for (const [id, fragments] of Object.entries(bodyChecks)) checks.set(id, bodyContains(id, fragments));
	checks.set("preserves_extend_config", childExists("preserves_extend_config", ["config", "EXTEND.md"]));
	checks.set("has_rules", childExists("has_rules", ["rules"]));
	checks.set("has_strategies", childExists("has_strategies", ["strategies"]));
	return checks;
}

function skillDocuments(root: string): Map<string, SkillDocument> {
	const documents = new Map<string, SkillDocument>();
	const skillRoot = resolve(root, "80_Skills");
	if (!existsSync(skillRoot)) return documents;
	const visit = (directory: string): void => {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			const path = resolve(directory, entry.name);
			if (entry.isDirectory()) visit(path);
			else if (entry.isFile() && entry.name === "SKILL.md") {
				const parsed = parseFrontmatterFile(path);
				const name = parsed.frontmatter?.name;
				if (typeof name === "string" && name) documents.set(name, { path, frontmatter: parsed.frontmatter ?? {}, body: parsed.body });
			}
		}
	};
	visit(skillRoot);
	return documents;
}

function nestedGet(value: Record<string, unknown>, ...keys: string[]): unknown {
	let current: unknown = value;
	for (const key of keys) {
		if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
		current = (current as Record<string, unknown>)[key];
	}
	return current;
}

function display(value: unknown): string {
	return value === undefined ? "undefined" : JSON.stringify(value);
}

function localDate(value: Date): string {
	const year = value.getFullYear();
	const month = String(value.getMonth() + 1).padStart(2, "0");
	const day = String(value.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

function roundEven(value: number): number {
	const floor = Math.floor(value);
	const fraction = value - floor;
	if (Math.abs(fraction - 0.5) < Number.EPSILON * 4) return floor % 2 === 0 ? floor : floor + 1;
	return Math.round(value);
}
