import {
	cpSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
} from "node:fs";
import { dirname, extname, relative, resolve, sep } from "node:path";
import { parseDocument } from "yaml";
import { atomicWrite } from "./files.ts";
import type { LayoutMigrationResult, LayoutMove } from "./types.ts";

export const KOS_LAYOUT_VERSION = 2;

export const LEGACY_LAYOUT_MOVES = [
	{ key: "radar", from: "50_信息雷达", to: "12_信息雷达" },
	{ key: "method", from: "40_方法库", to: "23_方法库" },
	{ key: "goal", from: "26_目标", to: "30_目标" },
	{ key: "project", from: "30_项目", to: "31_项目" },
	{ key: "task", from: "31_任务", to: "32_任务" },
	{ key: "diary", from: "23_日记", to: "40_日记" },
	{ key: "reflection", from: "24_认知记录", to: "41_认知记录" },
	{ key: "personal_operating_profile", from: "25_个人操作画像", to: "42_个人操作画像" },
	{ key: "skills", from: "41_Skills", to: "80_Skills" },
] as const;

const TEXT_EXTENSIONS = new Set([".json", ".md", ".toml", ".txt", ".yaml", ".yml"]);
const SKIP_DIRECTORY_NAMES = new Set([".git", ".obsidian", "framework-backups", "node_modules"]);
const STANDARD_LAYOUT_DIRECTORIES = [
	...LEGACY_LAYOUT_MOVES.map((move) => move.to),
	"12_信息雷达/主题监控",
	"12_信息雷达/公司监控",
	"12_信息雷达/宏观监控",
	"12_信息雷达/每日简报",
	"32_任务/归档",
	"80_Skills/core",
	"80_Skills/integrations",
	"80_Skills/personal",
	"80_Skills/incubator",
	"80_Skills/archived",
] as const;

function relativePath(path: string, root: string): string {
	return relative(root, path).split(sep).join("/");
}

function meaningfulEntries(path: string): string[] {
	if (!existsSync(path)) return [];
	if (!lstatSync(path).isDirectory()) return [relativePath(path, dirname(path))];
	const entries: string[] = [];
	const visit = (directory: string): void => {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			if (entry.name === ".gitkeep") continue;
			const child = resolve(directory, entry.name);
			if (entry.isDirectory()) visit(child);
			else entries.push(child);
		}
	};
	visit(path);
	return entries;
}

function textFiles(root: string): string[] {
	const files: string[] = [];
	const visit = (directory: string): void => {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			if (entry.isDirectory() && SKIP_DIRECTORY_NAMES.has(entry.name)) continue;
			const child = resolve(directory, entry.name);
			if (entry.isDirectory()) visit(child);
			else if (entry.isFile() && TEXT_EXTENSIONS.has(extname(entry.name).toLowerCase())) files.push(child);
		}
	};
	visit(root);
	return files.sort();
}

function rewriteContent(content: string): string {
	const placeholders = LEGACY_LAYOUT_MOVES.map((_, index) => `__KOS_LAYOUT_V2_MOVE_${index}__`);
	const staged = LEGACY_LAYOUT_MOVES.reduce(
		(updated, move, index) => updated.split(move.from).join(placeholders[index]!),
		content,
	);
	return LEGACY_LAYOUT_MOVES.reduce(
		(updated, move, index) => updated.split(placeholders[index]!).join(move.to),
		staged,
	);
}

function plannedRewrites(root: string): string[] {
	return textFiles(root)
		.filter((path) => {
			const content = readFileSync(path, "utf8");
			return rewriteContent(content) !== content;
		})
		.map((path) => relativePath(path, root));
}

function layoutVersion(root: string): number {
	const path = resolve(root, "90_系统/framework.yaml");
	if (!existsSync(path)) return 1;
	const value = parseDocument(readFileSync(path, "utf8")).get("layout_version");
	return typeof value === "number" && Number.isFinite(value) ? value : 1;
}

function migrationMoves(root: string, alreadyMigrated: boolean): { moves: LayoutMove[]; conflicts: string[] } {
	const conflicts: string[] = [];
	const legacySources = new Set<string>(LEGACY_LAYOUT_MOVES.map((move) => move.from));
	const moves = LEGACY_LAYOUT_MOVES.map((move): LayoutMove => {
		const source = resolve(root, move.from);
		const destination = resolve(root, move.to);
		const sourceExists = existsSync(source);
		const destinationEntries = meaningfulEntries(destination);
		if (alreadyMigrated) {
			return { ...move, state: "already_migrated", fileCount: destinationEntries.length };
		}
		// Several v1 source paths are v2 destinations. Their contents are staged
		// with the other moves before the new destination is populated.
		const destinationWillMove = legacySources.has(move.to) && existsSync(destination);
		if (sourceExists && destinationEntries.length && !destinationWillMove) {
			conflicts.push(`${move.from} -> ${move.to}: 目标目录已有 ${destinationEntries.length} 个文件`);
			return { ...move, state: "conflict", fileCount: meaningfulEntries(source).length };
		}
		if (sourceExists) return { ...move, state: "move", fileCount: meaningfulEntries(source).length };
		if (destinationWillMove || !existsSync(destination)) return { ...move, state: "create", fileCount: 0 };
		return { ...move, state: "already_migrated", fileCount: destinationEntries.length };
	});
	return { moves, conflicts };
}

function timestamp(): string {
	return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function updateLayoutVersion(root: string): void {
	const path = resolve(root, "90_系统/framework.yaml");
	mkdirSync(dirname(path), { recursive: true });
	const document = existsSync(path) ? parseDocument(readFileSync(path, "utf8")) : parseDocument("framework: kos-framework\n");
	document.set("layout_version", KOS_LAYOUT_VERSION);
	atomicWrite(path, document.toString());
}

export function migrateLayout(root: string, dryRun = false): LayoutMigrationResult {
	const resolvedRoot = resolve(root);
	const fromVersion = layoutVersion(resolvedRoot);
	const alreadyMigrated = fromVersion >= KOS_LAYOUT_VERSION;
	const { moves, conflicts } = migrationMoves(resolvedRoot, alreadyMigrated);
	const rewrittenPaths = alreadyMigrated ? [] : plannedRewrites(resolvedRoot);
	const result: LayoutMigrationResult = {
		fromVersion,
		toVersion: KOS_LAYOUT_VERSION,
		dryRun,
		applied: false,
		moves,
		rewrittenPaths,
		conflicts,
	};
	if (dryRun || alreadyMigrated) return result;
	if (conflicts.length) throw new Error(`Layout v2 migration has conflicts: ${conflicts.join("; ")}`);

	const backupRoot = resolve(resolvedRoot, "90_系统/framework-backups", `${timestamp()}-layout-v1`);
	const stagingRoot = resolve(resolvedRoot, "90_系统", `.layout-v2-staging-${process.pid}`);
	const externalRewritePaths = rewrittenPaths.filter((path) => !LEGACY_LAYOUT_MOVES.some((move) => path === move.from || path.startsWith(`${move.from}/`)));
	const manifestPath = resolve(resolvedRoot, "90_系统/framework.yaml");
	const manifestExisted = existsSync(manifestPath);
	mkdirSync(backupRoot, { recursive: true });
	try {
		for (const move of moves.filter((item) => item.state === "move")) {
			const source = resolve(resolvedRoot, move.from);
			const backup = resolve(backupRoot, "directories", move.from);
			mkdirSync(dirname(backup), { recursive: true });
			cpSync(source, backup, { recursive: true, preserveTimestamps: true });
		}
		for (const rel of externalRewritePaths) {
			const backup = resolve(backupRoot, "files", rel);
			mkdirSync(dirname(backup), { recursive: true });
			cpSync(resolve(resolvedRoot, rel), backup, { preserveTimestamps: true });
		}
		if (manifestExisted && !externalRewritePaths.includes("90_系统/framework.yaml")) {
			const backup = resolve(backupRoot, "files/90_系统/framework.yaml");
			mkdirSync(dirname(backup), { recursive: true });
			cpSync(manifestPath, backup, { preserveTimestamps: true });
		}

		mkdirSync(stagingRoot, { recursive: true });
		for (const move of moves.filter((item) => item.state === "move")) {
			renameSync(resolve(resolvedRoot, move.from), resolve(stagingRoot, move.key));
		}
		for (const move of moves.filter((item) => item.state === "move")) {
			const destination = resolve(resolvedRoot, move.to);
			if (existsSync(destination)) rmSync(destination, { recursive: true, force: true });
			mkdirSync(dirname(destination), { recursive: true });
			renameSync(resolve(stagingRoot, move.key), destination);
		}
		rmSync(stagingRoot, { recursive: true, force: true });
		for (const directory of STANDARD_LAYOUT_DIRECTORIES) {
			mkdirSync(resolve(resolvedRoot, directory), { recursive: true });
		}

		const appliedRewrites: string[] = [];
		for (const path of textFiles(resolvedRoot)) {
			const original = readFileSync(path, "utf8");
			const updated = rewriteContent(original);
			if (updated === original) continue;
			atomicWrite(path, updated);
			appliedRewrites.push(relativePath(path, resolvedRoot));
		}
		updateLayoutVersion(resolvedRoot);
		return { ...result, applied: true, backupPath: relativePath(backupRoot, resolvedRoot), rewrittenPaths: appliedRewrites };
	} catch (error) {
		rmSync(stagingRoot, { recursive: true, force: true });
		for (const move of moves.filter((item) => item.state === "move")) {
			rmSync(resolve(resolvedRoot, move.to), { recursive: true, force: true });
			const backup = resolve(backupRoot, "directories", move.from);
			if (existsSync(backup)) {
				mkdirSync(dirname(resolve(resolvedRoot, move.from)), { recursive: true });
				cpSync(backup, resolve(resolvedRoot, move.from), { recursive: true, preserveTimestamps: true });
			}
		}
		for (const rel of externalRewritePaths) {
			const backup = resolve(backupRoot, "files", rel);
			if (existsSync(backup)) {
				mkdirSync(dirname(resolve(resolvedRoot, rel)), { recursive: true });
				cpSync(backup, resolve(resolvedRoot, rel), { preserveTimestamps: true });
			}
		}
		const manifestBackup = resolve(backupRoot, "files/90_系统/framework.yaml");
		if (existsSync(manifestBackup)) {
			mkdirSync(dirname(manifestPath), { recursive: true });
			cpSync(manifestBackup, manifestPath, { preserveTimestamps: true });
		} else if (!manifestExisted) {
			rmSync(manifestPath, { force: true });
		}
		throw error;
	}
}
