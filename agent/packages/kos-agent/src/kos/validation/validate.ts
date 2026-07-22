import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, relative, resolve, sep } from "node:path";
import { loadObjectSchemas } from "./schemas.ts";
import { parseFrontmatterFile } from "./frontmatter.ts";
import { validateSkillEvals } from "./skill-evals.ts";
import { validateSkills } from "./skills.ts";
import type {
	ObjectSchema,
	SchemaRule,
	ValidationFinding,
	ValidationReport,
	ValidatorName,
} from "./types.ts";

const ROOT_MARKERS = [".kos.md", ".hermes.md"];
const SKIP_NAMES = new Set([".kos.md", ".hermes.md", "README.md", "AGENTS.md", "CLAUDE.md", "HERMES.md"]);
const EXCLUDED_DIRS = new Set([".git", ".obsidian", "80_Skills", "90_系统"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const REQUIRED_VAULT_DIRS = [
	"00_工作台",
	"10_收件箱",
	"11_原材料",
	"11_原材料/书籍",
	"11_原材料/播客",
	"11_原材料/文章",
	"11_原材料/新闻",
	"11_原材料/研报",
	"11_原材料/视频",
	"11_原材料/论文",
	"12_信息雷达",
	"12_信息雷达/主题监控",
	"12_信息雷达/公司监控",
	"12_信息雷达/宏观监控",
	"12_信息雷达/每日简报",
	"20_处理区",
	"20_处理区/摘录",
	"20_处理区/摘要",
	"21_研究",
	"22_知识库",
	"23_方法库",
	"30_目标",
	"31_项目",
	"32_任务",
	"32_任务/归档",
	"40_日记",
	"41_认知记录",
	"42_个人操作画像",
	"80_Skills",
	"80_Skills/core",
	"80_Skills/integrations",
	"80_Skills/personal",
	"80_Skills/incubator",
	"80_Skills/archived",
	"90_系统/规则",
	"90_系统/模板",
	"90_系统/集成",
	"90_系统/evals",
	"90_系统/evals/contracts",
	"90_系统/evals/skills",
	"90_系统/evals/artifacts",
	"90_系统/工作流",
	"90_系统/工作流/项目启动计划",
	"90_系统/文档",
] as const;

const STATUS_FIELD_BY_TYPE: Readonly<Record<string, string>> = {
	goal: "status",
	source: "status",
	research: "status",
	concept: "status",
	project: "status",
	task: "status",
	reflection: "status",
	method: "status",
	personal_operating_profile: "status",
	topic_watch: "status",
	company_watch: "status",
};

export function findVaultRoot(start: string): string | undefined {
	let current = resolve(start);
	if (existsSync(current) && !lstatSync(current).isDirectory()) current = dirname(current);
	while (true) {
		if (ROOT_MARKERS.some((marker) => existsSync(resolve(current, marker)))) return current;
		const parent = dirname(current);
		if (parent === current) return undefined;
		current = parent;
	}
}

function relativePath(path: string, root: string): string {
	return relative(root, path).split(sep).join("/");
}

function isInsideRoot(path: string, root: string): boolean {
	const rel = relative(root, path);
	return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== "..");
}

function isObjectPath(path: string, root: string): boolean {
	if (!path.endsWith(".md") || SKIP_NAMES.has(basename(path)) || !isInsideRoot(path, root)) return false;
	return !relativePath(path, root).split("/").some((part) => EXCLUDED_DIRS.has(part));
}

function collectMarkdownFiles(directory: string, root: string): string[] {
	const files: string[] = [];
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		if (entry.isDirectory() && EXCLUDED_DIRS.has(entry.name)) continue;
		const path = resolve(directory, entry.name);
		if (entry.isDirectory()) files.push(...collectMarkdownFiles(path, root));
		else if (entry.isFile() && isObjectPath(path, root)) files.push(path);
	}
	return files.sort();
}

function finding(
	validator: ValidatorName,
	level: ValidationFinding["level"],
	path: string,
	message: string,
): ValidationFinding {
	return { validator, level, path, message };
}

function valueDisplay(value: unknown): string {
	return typeof value === "string" ? JSON.stringify(value) : JSON.stringify(value);
}

function kindError(value: unknown, rule: SchemaRule): string | undefined {
	switch (rule.kind) {
		case "string":
			return typeof value === "string" ? undefined : "应为字符串";
		case "date":
			return value instanceof Date || (typeof value === "string" && DATE_RE.test(value)) ? undefined : "应为 YYYY-MM-DD 日期";
		case "int":
			return typeof value === "number" && Number.isInteger(value) ? undefined : "应为整数";
		case "bool":
			return typeof value === "boolean" ? undefined : "应为布尔值 true/false";
		case "list":
			return Array.isArray(value) ? undefined : "应为数组";
		case "map":
			return value && typeof value === "object" && !Array.isArray(value) ? undefined : "应为对象";
		case "enum":
			return (rule.values ?? []).includes(value) ? undefined : `应为枚举值之一：${JSON.stringify(rule.values ?? [])}`;
		default:
			return `未知 schema kind: ${(rule as { kind?: unknown }).kind}`;
	}
}

function validatePath(rel: string, frontmatter: Record<string, unknown>, schema: ObjectSchema): ValidationFinding[] {
	if (frontmatter.type === "project" && rel.startsWith("31_项目/")) {
		const parts = rel.split("/");
		const fileName = parts.at(-1)?.replace(/\.md$/, "");
		const directoryName = parts.at(-2);
		if (parts.length < 3 || !fileName || fileName !== directoryName) {
			return [finding("paths", "ERROR", rel, "Project 主文件必须位于 `31_项目/<项目名>/<项目名>.md`；同目录其他文件作为项目资料")];
		}
	}
	if (schema.paths.some((prefix) => rel === prefix || rel.startsWith(`${prefix}/`))) return [];
	return [finding("paths", "WARN", rel, `type=${String(frontmatter.type)} 使用个性化目录；标准目录：${JSON.stringify(schema.paths)}`)];
}

function validateSchema(rel: string, frontmatter: Record<string, unknown>, schema: ObjectSchema): ValidationFinding[] {
	const findings: ValidationFinding[] = [];
	for (const [field, rule] of Object.entries(schema.required)) {
		if (!(field in frontmatter)) {
			findings.push(finding("schema", "ERROR", rel, `缺少必填字段 \`${field}\``));
			continue;
		}
		const error = kindError(frontmatter[field], rule);
		if (error) findings.push(finding("schema", "ERROR", rel, `\`${field}\` ${error}，当前值：${valueDisplay(frontmatter[field])}`));
	}
	for (const [field, value] of Object.entries(frontmatter)) {
		if (field in schema.required) continue;
		const rule = schema.optional?.[field];
		if (!rule) continue;
		const error = kindError(value, rule);
		if (error) findings.push(finding("schema", "ERROR", rel, `\`${field}\` ${error}，当前值：${valueDisplay(value)}`));
	}
	return findings;
}

function validateState(rel: string, frontmatter: Record<string, unknown>, schema: ObjectSchema): ValidationFinding[] {
	const field = STATUS_FIELD_BY_TYPE[schema.type];
	if (!field) return [];
	if (!(field in frontmatter)) return [finding("state", "ERROR", rel, `type=${schema.type} 缺少状态字段 \`${field}\``)];
	const rule = schema.required[field] ?? schema.optional?.[field];
	if (!rule?.values || rule.values.includes(frontmatter[field])) return [];
	return [finding("state", "ERROR", rel, `\`${field}\` 状态非法：${valueDisplay(frontmatter[field])}，允许：${JSON.stringify(rule.values)}`)];
}

function validateBusinessRules(rel: string, frontmatter: Record<string, unknown>): ValidationFinding[] {
	const findings: ValidationFinding[] = [];
	if (frontmatter.type === "goal") {
		const period = String(frontmatter.period ?? "");
		const match = /^(\d{4})-(H1|H2)$/.exec(period);
		if (!match) findings.push(finding("business", "ERROR", rel, "`period` 必须使用 YYYY-H1 或 YYYY-H2"));
		else if (frontmatter.horizon !== match[2]) findings.push(finding("business", "ERROR", rel, "`horizon` 必须与 `period` 一致"));
		if (frontmatter.status === "active" && (!(typeof frontmatter.allocation_weight === "number") || frontmatter.allocation_weight <= 0)) {
			findings.push(finding("business", "ERROR", rel, "active Goal 的 `allocation_weight` 必须大于 0"));
		}
	}
	if (frontmatter.type === "project") {
		const processMetrics = Array.isArray(frontmatter.process_metrics) ? frontmatter.process_metrics.filter(Boolean) : [];
		const resultMetrics = Array.isArray(frontmatter.result_metrics) ? frontmatter.result_metrics.filter(Boolean) : [];
		if (processMetrics.length + resultMetrics.length === 0) {
			findings.push(finding("business", "ERROR", rel, "Project 至少需要一个量化过程指标或结果指标"));
		}
		const ids = new Set<string>();
		for (const [kind, metrics] of [["process", processMetrics], ["result", resultMetrics]] as const) {
			for (const metric of metrics) {
				if (typeof metric === "string") {
					findings.push(finding("business", "WARN", rel, `Project ${kind} 指标仍是旧字符串格式，应迁移为带稳定 id 的结构化指标`));
					continue;
				}
				if (!metric || typeof metric !== "object" || Array.isArray(metric)) {
					findings.push(finding("business", "ERROR", rel, `Project ${kind} 指标必须是对象`));
					continue;
				}
				const value = metric as Record<string, unknown>;
				const id = String(value.id ?? "");
				if (!/^[a-z0-9][a-z0-9_-]*$/.test(id) || ids.has(id)) findings.push(finding("business", "ERROR", rel, `Project 指标 id 非法或重复：${id || "<empty>"}`));
				if (value.kind !== kind || !String(value.name ?? "").trim() || !String(value.unit ?? "").trim() || ![value.baseline, value.target, value.current].every((item) => typeof item === "number" && Number.isFinite(item))) {
					findings.push(finding("business", "ERROR", rel, `Project 指标 ${id || "<empty>"} 缺少 kind/name/unit/baseline/target/current`));
				}
				ids.add(id);
			}
		}
		if (frontmatter.off_goal_override === true && (!String(frontmatter.override_reason ?? "").trim() || !DATE_RE.test(String(frontmatter.override_review_due ?? "")))) {
			findings.push(finding("business", "ERROR", rel, "低支持度 Project override 必须记录理由和 YYYY-MM-DD 复查日期"));
		}
		if (frontmatter.status === "completed" && (typeof frontmatter.validation_completed !== "boolean" || typeof frontmatter.expected_result_achieved !== "boolean")) {
			findings.push(finding("business", "ERROR", rel, "completed Project 必须分别记录验证是否完成和预期结果是否达成"));
		}
	}
	if (frontmatter.type === "task") {
		if (frontmatter.status === "blocked" && (!String(frontmatter.blocked_reason ?? "").trim() || !String(frontmatter.unblock_condition ?? "").trim())) {
			findings.push(finding("business", "ERROR", rel, "blocked Task 必须记录 `blocked_reason` 和 `unblock_condition`"));
		}
		if (frontmatter.status === "done" && !String(frontmatter.result ?? "").trim()) {
			findings.push(finding("business", "ERROR", rel, "done Task 必须记录非空 `result`"));
		}
		if (Array.isArray(frontmatter.projects) && frontmatter.status === "done") {
			const contributions = Array.isArray(frontmatter.project_contributions) ? frontmatter.project_contributions : [];
			if (contributions.length !== frontmatter.projects.length) {
				findings.push(finding("business", "ERROR", rel, "done Task 必须为每个关联 Project 记录一条贡献判断"));
			}
			if (frontmatter.projects.length > 0 && rel.startsWith("32_任务/") && !rel.startsWith("32_任务/归档/")) {
				findings.push(finding("business", "WARN", rel, "已完成且关联 Project，可在看板确认后移入 `32_任务/归档/<完成年份>/`"));
			}
		}
	}
	return findings;
}

function validateGoalAllocations(files: readonly string[], root: string): ValidationFinding[] {
	const groups = new Map<string, Array<{ rel: string; weight: number }>>();
	for (const path of files) {
		const parsed = parseFrontmatterFile(path);
		if (parsed.frontmatter?.type !== "goal" || parsed.frontmatter.status !== "active") continue;
		const period = String(parsed.frontmatter.period ?? "<missing>");
		const entries = groups.get(period) ?? [];
		entries.push({ rel: relativePath(path, root), weight: Number(parsed.frontmatter.allocation_weight) });
		groups.set(period, entries);
	}
	const findings: ValidationFinding[] = [];
	for (const [period, goals] of groups) {
		const total = goals.reduce((sum, goal) => sum + (Number.isFinite(goal.weight) ? goal.weight : 0), 0);
		if (total !== 100) {
			findings.push(finding("business", "ERROR", `30_目标/${period}`, `active Goal 投入占比合计必须为 100，当前为 ${total}（${goals.map((goal) => goal.rel).join("、")}）`));
		}
	}
	return findings;
}

function validateFile(path: string, root: string): ValidationFinding[] {
	const rel = relativePath(path, root);
	const parsed = parseFrontmatterFile(path);
	if (parsed.parseError) return [finding("schema", "ERROR", rel, `frontmatter YAML 无法解析：${parsed.parseError}`)];
	if (parsed.frontmatter === null) {
		const parts = rel.split("/");
		const isProjectMaterial = parts[0] === "31_项目" && parts.length >= 3 && parts.at(-1)?.replace(/\.md$/, "") !== parts.at(-2);
		return isProjectMaterial ? [] : [finding("schema", "WARN", rel, "缺少 frontmatter")];
	}
	const type = parsed.frontmatter.type;
	if (!type) return [finding("schema", "WARN", rel, "缺少 type 字段")];
	const schema = loadObjectSchemas().get(String(type));
	if (!schema) return [finding("schema", "INFO", rel, `type=${String(type)} 暂无 schema，跳过字段校验`)];
	return [
		...validatePath(rel, parsed.frontmatter, schema),
		...validateSchema(rel, parsed.frontmatter, schema),
		...validateState(rel, parsed.frontmatter, schema),
		...validateBusinessRules(rel, parsed.frontmatter),
	];
}

function report(root: string, paths: string[], findings: ValidationFinding[]): ValidationReport {
	const errorCount = findings.filter((item) => item.level === "ERROR").length;
	const warningCount = findings.filter((item) => item.level === "WARN").length;
	return {
		root,
		validatedPaths: paths.map((path) => relativePath(path, root)),
		findings,
		errorCount,
		warningCount,
		passed: errorCount === 0,
	};
}

export function validateChangedFiles(root: string, paths: readonly string[]): ValidationReport {
	const resolvedRoot = resolve(root);
	const files = [...new Set(paths.map((path) => resolve(resolvedRoot, path)))].filter(
		(path) => existsSync(path) && isObjectPath(path, resolvedRoot),
	);
	const findings = files.flatMap((path) => validateFile(path, resolvedRoot));
	if (files.some((path) => parseFrontmatterFile(path).frontmatter?.type === "goal")) {
		findings.push(...validateGoalAllocations(collectMarkdownFiles(resolvedRoot, resolvedRoot), resolvedRoot));
	}
	return report(resolvedRoot, files, findings);
}

export function validateVault(root: string): ValidationReport {
	const resolvedRoot = resolve(root);
	const findings: ValidationFinding[] = [];
	for (const rel of REQUIRED_VAULT_DIRS) {
		const path = resolve(resolvedRoot, rel);
		if (!existsSync(path) || !lstatSync(path).isDirectory()) {
			findings.push(finding("paths", "ERROR", rel, "缺少框架要求的目录"));
		}
	}
	const nested = resolve(resolvedRoot, basename(resolvedRoot));
	if (existsSync(nested)) {
		findings.push(finding("paths", "ERROR", relativePath(nested, resolvedRoot), "发现嵌套 vault 目录"));
	}
	const files = collectMarkdownFiles(resolvedRoot, resolvedRoot);
	findings.push(...files.flatMap((path) => validateFile(path, resolvedRoot)));
	findings.push(...validateGoalAllocations(files, resolvedRoot));
	const skillReport = validateSkills(resolvedRoot);
	const evalReport = validateSkillEvals(resolvedRoot);
	findings.push(...skillReport.findings, ...evalReport.findings);
	const validationPaths = [
		...files,
		...skillReport.validatedPaths.map((path) => resolve(resolvedRoot, path)),
		...evalReport.validatedPaths.map((path) => resolve(resolvedRoot, path)),
	];
	return report(resolvedRoot, validationPaths, findings);
}

export function formatValidationSummary(report: ValidationReport): string {
	if (report.findings.length === 0) return `Validation passed (${report.validatedPaths.length} file)`;
	const lines = report.findings.map((item) => `[${item.level}] ${item.path}: ${item.message}`);
	return [`Validation ${report.passed ? "passed with findings" : "failed"}: ${report.errorCount} error, ${report.warningCount} warning`, ...lines].join("\n");
}
