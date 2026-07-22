import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync } from "node:fs";
import { dirname, extname, relative, resolve, sep } from "node:path";
import { parseDocument } from "yaml";
import { validateChangedFiles } from "../validation/validate.ts";
import { atomicWrite } from "./files.ts";
import { sanitizeFileName } from "./create-object.ts";
import type { ProjectDirectoryMigrationResult, ProjectDirectoryMove } from "./types.ts";

const FRONTMATTER = /^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/;
const TEXT_EXTENSIONS = new Set([".json", ".md", ".toml", ".txt", ".yaml", ".yml"]);
const SKIP_DIRECTORIES = new Set([".git", ".obsidian", "framework-backups", "node_modules"]);

function relativePath(path: string, root: string): string {
	return relative(root, path).split(sep).join("/");
}

function filesUnder(directory: string, predicate: (path: string) => boolean): string[] {
	if (!existsSync(directory)) return [];
	const files: string[] = [];
	const visit = (current: string): void => {
		for (const entry of readdirSync(current, { withFileTypes: true })) {
			if (entry.isDirectory() && SKIP_DIRECTORIES.has(entry.name)) continue;
			const path = resolve(current, entry.name);
			if (entry.isDirectory()) visit(path);
			else if (entry.isFile() && predicate(path)) files.push(path);
		}
	};
	visit(directory);
	return files.sort();
}

function projectTitle(path: string): string | undefined {
	const match = FRONTMATTER.exec(readFileSync(path, "utf8"));
	if (!match) return undefined;
	const document = parseDocument(match[1]);
	if (document.errors.length || document.get("type") !== "project") return undefined;
	const title = sanitizeFileName(String(document.get("title") ?? ""));
	return title || undefined;
}

function canonicalProjectPath(projectRoot: string, path: string, title: string): string {
	const parts = relativePath(path, projectRoot).split("/");
	const directoryName = parts.length === 1 ? title : parts[0]!;
	return resolve(projectRoot, directoryName, `${directoryName}.md`);
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function rewriteReferences(content: string, moves: ProjectDirectoryMove[]): string {
	return moves.reduce((updated, move) => {
		if (move.state !== "move") return updated;
		const from = move.from.replace(/\.md$/, "");
		const to = move.to.replace(/\.md$/, "");
		return updated.replace(new RegExp(`${escapeRegExp(from)}(?!/)`, "g"), to);
	}, content);
}

function timestamp(): string {
	return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function emptyValidation(root: string) {
	return { root: resolve(root), validatedPaths: [], findings: [], errorCount: 0, warningCount: 0, passed: true };
}

export function migrateProjectDirectories(root: string, dryRun = false): ProjectDirectoryMigrationResult {
	const resolvedRoot = resolve(root);
	const projectRoot = resolve(resolvedRoot, "31_项目");
	const projectFiles = filesUnder(projectRoot, (path) => path.endsWith(".md"))
		.map((path) => ({ path, title: projectTitle(path) }))
		.filter((item): item is { path: string; title: string } => Boolean(item.title));
	const destinations = new Map<string, string[]>();
	for (const project of projectFiles) {
		const destination = canonicalProjectPath(projectRoot, project.path, project.title);
		const values = destinations.get(destination) ?? [];
		values.push(project.path);
		destinations.set(destination, values);
	}
	const conflicts: string[] = [];
	const moves: ProjectDirectoryMove[] = projectFiles.map((project) => {
		const destination = canonicalProjectPath(projectRoot, project.path, project.title);
		const from = relativePath(project.path, resolvedRoot);
		const to = relativePath(destination, resolvedRoot);
		if (project.path === destination) return { from, to, state: "already_canonical" };
		if ((existsSync(destination) && !projectFiles.some((item) => item.path === destination)) || (destinations.get(destination)?.length ?? 0) > 1) {
			conflicts.push(`${from} -> ${to}`);
			return { from, to, state: "conflict" };
		}
		return { from, to, state: "move" };
	});
	const textFiles = filesUnder(resolvedRoot, (path) => TEXT_EXTENSIONS.has(extname(path).toLowerCase()));
	const rewrittenPaths = textFiles.filter((path) => rewriteReferences(readFileSync(path, "utf8"), moves) !== readFileSync(path, "utf8")).map((path) => relativePath(path, resolvedRoot));
	const result: ProjectDirectoryMigrationResult = {
		dryRun, applied: false, scanned: projectFiles.length, moves, rewrittenPaths, conflicts, validation: emptyValidation(resolvedRoot),
	};
	if (dryRun || moves.every((move) => move.state === "already_canonical")) return result;
	if (conflicts.length) throw new Error(`Project directory migration has conflicts: ${conflicts.join("; ")}`);

	const backupRoot = resolve(resolvedRoot, "90_系统/framework-backups", `${timestamp()}-project-directories`);
	const projectBackup = resolve(backupRoot, "31_项目");
	mkdirSync(backupRoot, { recursive: true });
	if (existsSync(projectRoot)) cpSync(projectRoot, projectBackup, { recursive: true, preserveTimestamps: true });
	for (const path of rewrittenPaths.filter((path) => !path.startsWith("31_项目/"))) {
		const backup = resolve(backupRoot, "files", path);
		mkdirSync(dirname(backup), { recursive: true });
		cpSync(resolve(resolvedRoot, path), backup, { preserveTimestamps: true });
	}
	try {
		for (const move of moves.filter((item) => item.state === "move")) {
			const destination = resolve(resolvedRoot, move.to);
			mkdirSync(dirname(destination), { recursive: true });
			renameSync(resolve(resolvedRoot, move.from), destination);
		}
		const appliedRewrites: string[] = [];
		for (const originalPath of textFiles) {
			const moved = moves.find((move) => move.state === "move" && resolve(resolvedRoot, move.from) === originalPath);
			const path = moved ? resolve(resolvedRoot, moved.to) : originalPath;
			if (!existsSync(path)) continue;
			const original = readFileSync(path, "utf8");
			const updated = rewriteReferences(original, moves);
			if (updated === original) continue;
			atomicWrite(path, updated);
			appliedRewrites.push(relativePath(path, resolvedRoot));
		}
		const movedPaths = moves.filter((move) => move.state === "move").map((move) => resolve(resolvedRoot, move.to));
		const validation = validateChangedFiles(resolvedRoot, movedPaths);
		const migrationPathErrors = validation.findings.filter((finding) => finding.validator === "paths" && finding.level === "ERROR");
		if (migrationPathErrors.length) throw new Error(`Migrated Projects have invalid paths: ${JSON.stringify(migrationPathErrors)}`);
		return { ...result, applied: true, rewrittenPaths: appliedRewrites, backupPath: relativePath(backupRoot, resolvedRoot), validation };
	} catch (error) {
		rmSync(projectRoot, { recursive: true, force: true });
		if (existsSync(projectBackup)) cpSync(projectBackup, projectRoot, { recursive: true, preserveTimestamps: true });
		for (const path of rewrittenPaths.filter((path) => !path.startsWith("31_项目/"))) {
			const backup = resolve(backupRoot, "files", path);
			if (existsSync(backup)) cpSync(backup, resolve(resolvedRoot, path), { preserveTimestamps: true });
		}
		throw error;
	}
}
