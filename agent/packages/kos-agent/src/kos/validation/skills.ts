import { existsSync, readdirSync } from "node:fs";
import { basename, relative, resolve, sep } from "node:path";
import { parseFrontmatterFile } from "./frontmatter.ts";
import type { ValidationFinding, ValidationReport } from "./types.ts";

const SCOPE_DIRS: Readonly<Record<string, string>> = {
	core: "core",
	integration: "integrations",
	personal: "personal",
	incubator: "incubator",
	archived: "archived",
};

function relpath(path: string, root: string): string {
	return relative(root, path).split(sep).join("/");
}

function nestedGet(data: Record<string, unknown>, ...keys: string[]): unknown {
	let current: unknown = data;
	for (const key of keys) {
		if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
		current = (current as Record<string, unknown>)[key];
	}
	return current;
}

function collectSkillFiles(root: string): string[] {
	const skillRoot = resolve(root, "41_Skills");
	if (!existsSync(skillRoot)) return [];
	const files: string[] = [];
	const visit = (directory: string): void => {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			const path = resolve(directory, entry.name);
			if (entry.isDirectory()) visit(path);
			else if (entry.isFile() && entry.name === "SKILL.md") files.push(path);
		}
	};
	visit(skillRoot);
	return files.sort();
}

function expectedScope(path: string, root: string): string | undefined {
	const parts = relpath(path, resolve(root, "41_Skills")).split("/");
	if (parts.length < 3 || parts[parts.length - 1] !== "SKILL.md") return undefined;
	return Object.entries(SCOPE_DIRS).find(([, directory]) => directory === parts[0])?.[0];
}

function validateSkillFile(path: string, root: string): ValidationFinding[] {
	const rel = relpath(path, root);
	const findings: ValidationFinding[] = [];
	const add = (level: ValidationFinding["level"], message: string): void => {
		findings.push({ level, validator: "skills", path: rel, message });
	};
	const parsed = parseFrontmatterFile(path);
	if (parsed.parseError) {
		add("ERROR", `frontmatter YAML 无法解析：${parsed.parseError}`);
		return findings;
	}
	if (!parsed.frontmatter) {
		add("ERROR", "缺少 frontmatter");
		return findings;
	}
	const fm = parsed.frontmatter;
	const name = fm.name;
	if (!name) add("ERROR", "缺少 name");
	else if (basename(resolve(path, "..")) !== String(name)) add("WARN", `name 与目录名不一致：name=${String(name)}`);
	for (const field of ["description", "version"]) {
		if (!fm[field]) add("ERROR", `缺少 ${field}`);
	}

	const scope = nestedGet(fm, "metadata", "kos", "scope");
	const lifecycle = nestedGet(fm, "metadata", "kos", "lifecycle");
	const pinned = nestedGet(fm, "metadata", "hermes", "pinned");
	const promoted = nestedGet(fm, "metadata", "kos", "promoted");
	const reviewRequired = nestedGet(fm, "metadata", "kos", "review_required");
	const objectTypes = nestedGet(fm, "metadata", "kos", "object_types");
	const externalSystems = nestedGet(fm, "metadata", "kos", "external_systems");
	const expected = expectedScope(path, root);
	if (!expected) add("ERROR", "SKILL.md 不在允许的 scope 目录下");
	else if (scope !== expected) add("ERROR", `metadata.kos.scope 应为 ${expected}`);
	if (!(String(scope) in SCOPE_DIRS)) add("ERROR", "metadata.kos.scope 缺失或非法");
	if (!["active", "experimental", "deprecated", "archived"].includes(String(lifecycle))) {
		add("ERROR", "metadata.kos.lifecycle 缺失或非法");
	}
	if (typeof pinned !== "boolean") add("ERROR", "metadata.hermes.pinned 必须为布尔值");
	if (typeof promoted !== "boolean") add("ERROR", "metadata.kos.promoted 必须为布尔值");
	if (typeof reviewRequired !== "boolean") add("ERROR", "metadata.kos.review_required 必须为布尔值");
	if (!Array.isArray(objectTypes)) add("ERROR", "metadata.kos.object_types 必须为数组");
	if (!Array.isArray(externalSystems)) add("ERROR", "metadata.kos.external_systems 必须为数组");
	if (scope === "core" && pinned !== true) add("ERROR", "core Skill 必须 pinned: true");
	if (scope === "integration" && (!Array.isArray(externalSystems) || externalSystems.length === 0)) {
		add("ERROR", "integration Skill 必须声明 external_systems");
	}
	if (scope === "incubator") {
		if (pinned !== false) add("ERROR", "incubator Skill 必须 pinned: false");
		if (promoted !== false) add("ERROR", "incubator Skill 必须 promoted: false");
		if (reviewRequired !== true) add("ERROR", "incubator Skill 必须 review_required: true");
	}
	if (scope === "archived") {
		if (pinned !== false) add("ERROR", "archived Skill 必须 pinned: false");
		if (lifecycle !== "archived") add("ERROR", "archived Skill 必须 lifecycle: archived");
	}
	return findings;
}

function buildReport(root: string, files: string[], findings: ValidationFinding[]): ValidationReport {
	const errorCount = findings.filter((item) => item.level === "ERROR").length;
	const warningCount = findings.filter((item) => item.level === "WARN").length;
	return {
		root,
		validatedPaths: files.map((file) => relpath(file, root)),
		findings,
		errorCount,
		warningCount,
		passed: errorCount === 0,
	};
}

export function validateSkillFiles(root: string, paths: readonly string[]): ValidationReport {
	const resolvedRoot = resolve(root);
	const files = [...new Set(paths.map((path) => resolve(resolvedRoot, path)))].filter(
		(path) => existsSync(path) && basename(path) === "SKILL.md" && relpath(path, resolvedRoot).startsWith("41_Skills/"),
	);
	return buildReport(resolvedRoot, files, files.flatMap((path) => validateSkillFile(path, resolvedRoot)));
}

export function validateSkills(root: string): ValidationReport {
	const resolvedRoot = resolve(root);
	const skillRoot = resolve(resolvedRoot, "41_Skills");
	const findings: ValidationFinding[] = [];
	if (!existsSync(skillRoot)) {
		findings.push({ level: "ERROR", validator: "skills", path: "41_Skills", message: "缺少 Skill 根目录" });
		return buildReport(resolvedRoot, [], findings);
	}
	for (const directory of Object.values(SCOPE_DIRS)) {
		if (!existsSync(resolve(skillRoot, directory))) {
			findings.push({ level: "ERROR", validator: "skills", path: `41_Skills/${directory}`, message: "缺少 Skill scope 目录" });
		}
	}
	const files = collectSkillFiles(resolvedRoot);
	findings.push(...files.flatMap((path) => validateSkillFile(path, resolvedRoot)));
	return buildReport(resolvedRoot, files, findings);
}

export function skillNames(root: string): Set<string> {
	const names = new Set<string>();
	for (const path of collectSkillFiles(resolve(root))) {
		const name = parseFrontmatterFile(path).frontmatter?.name;
		if (typeof name === "string" && name) names.add(name);
	}
	return names;
}
