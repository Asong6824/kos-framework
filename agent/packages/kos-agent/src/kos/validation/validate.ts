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
const EXCLUDED_DIRS = new Set([".git", ".obsidian", "41_Skills", "90_系统"]);
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
	"20_处理区",
	"20_处理区/摘录",
	"20_处理区/摘要",
	"21_研究",
	"22_知识库",
	"23_日记",
	"24_认知记录",
	"25_个人操作画像",
	"30_项目",
	"31_任务",
	"40_方法库",
	"41_Skills",
	"41_Skills/core",
	"41_Skills/integrations",
	"41_Skills/personal",
	"41_Skills/incubator",
	"41_Skills/archived",
	"50_信息雷达",
	"50_信息雷达/主题监控",
	"50_信息雷达/公司监控",
	"50_信息雷达/宏观监控",
	"50_信息雷达/每日简报",
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
		case "enum":
			return (rule.values ?? []).includes(value) ? undefined : `应为枚举值之一：${JSON.stringify(rule.values ?? [])}`;
		default:
			return `未知 schema kind: ${(rule as { kind?: unknown }).kind}`;
	}
}

function validatePath(rel: string, frontmatter: Record<string, unknown>, schema: ObjectSchema): ValidationFinding[] {
	if (schema.paths.some((prefix) => rel === prefix || rel.startsWith(`${prefix}/`))) return [];
	return [finding("paths", "ERROR", rel, `type=${String(frontmatter.type)} 不应放在此目录；允许目录：${JSON.stringify(schema.paths)}`)];
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

function validateFile(path: string, root: string): ValidationFinding[] {
	const rel = relativePath(path, root);
	const parsed = parseFrontmatterFile(path);
	if (parsed.parseError) return [finding("schema", "ERROR", rel, `frontmatter YAML 无法解析：${parsed.parseError}`)];
	if (parsed.frontmatter === null) return [finding("schema", "WARN", rel, "缺少 frontmatter")];
	const type = parsed.frontmatter.type;
	if (!type) return [finding("schema", "WARN", rel, "缺少 type 字段")];
	const schema = loadObjectSchemas().get(String(type));
	if (!schema) return [finding("schema", "INFO", rel, `type=${String(type)} 暂无 schema，跳过字段校验`)];
	return [
		...validatePath(rel, parsed.frontmatter, schema),
		...validateSchema(rel, parsed.frontmatter, schema),
		...validateState(rel, parsed.frontmatter, schema),
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
	return report(resolvedRoot, files, files.flatMap((path) => validateFile(path, resolvedRoot)));
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
