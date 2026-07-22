import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync } from "node:fs";
import { basename, dirname, extname, relative, resolve, sep } from "node:path";
import { parseDocument } from "yaml";
import { validateChangedFiles } from "../validation/validate.ts";
import { atomicWrite, resolveInsideRoot } from "./files.ts";
import type {
	CompleteTaskInput,
	CompleteTaskResult,
	ArchiveTaskInput,
	ArchiveTaskResult,
	DeferTaskInput,
	OperationResult,
	ReturnTaskToPoolInput,
	TaskPoolEntry,
	TaskPoolResult,
	UpdateTaskInput,
} from "./types.ts";

const FRONTMATTER = /^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PRIORITIES = new Set(["P0", "P1", "P2", "P3", "P4"]);
const TEXT_EXTENSIONS = new Set([".json", ".md", ".toml", ".txt", ".yaml", ".yml"]);
const ARCHIVE_PREFIX = "32_任务/归档/";

function localDate(): string {
	const now = new Date();
	return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function markdownFiles(directory: string): string[] {
	const files: string[] = [];
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		if ([".git", ".obsidian", "node_modules", "80_Skills", "90_系统"].includes(entry.name)) continue;
		const path = resolve(directory, entry.name);
		if (entry.isDirectory()) files.push(...markdownFiles(path));
		else if (entry.isFile() && entry.name.endsWith(".md")) files.push(path);
	}
	return files;
}

function strings(value: unknown): string[] {
	const resolved = value && typeof value === "object" && "toJSON" in value && typeof value.toJSON === "function" ? value.toJSON() : value;
	return Array.isArray(resolved) ? resolved.filter((item): item is string => typeof item === "string" && item.trim() !== "") : [];
}

function taskDocument(root: string, path: string) {
	const target = resolveInsideRoot(root, path);
	const original = readFileSync(target.absolute, "utf8");
	const match = FRONTMATTER.exec(original);
	if (!match) throw new Error(`Task has no frontmatter: ${target.relative}`);
	const document = parseDocument(match[1]);
	if (document.errors.length) throw new Error(`Task frontmatter is invalid: ${target.relative}`);
	if (document.get("type") !== "task") throw new Error(`Object is not a Task: ${target.relative}`);
	const legacy = String(document.get("project") ?? "").trim();
	const projects = [...new Set([...strings(document.get("projects")), ...(legacy ? [legacy] : [])])];
	document.set("projects", projects);
	if (document.has("project")) document.delete("project");
	return { target, original, match, document, projects };
}

function render(original: string, match: RegExpExecArray, document: ReturnType<typeof parseDocument>): string {
	return `---\n${document.toString().trim()}\n---\n${original.slice(match[0].length)}`;
}

function writeTask(root: string, path: string, mutate: (task: ReturnType<typeof taskDocument>) => void): OperationResult {
	const task = taskDocument(root, path);
	mutate(task);
	atomicWrite(task.target.absolute, render(task.original, task.match, task.document));
	const validation = validateChangedFiles(root, [task.target.absolute]);
	if (!validation.passed) {
		atomicWrite(task.target.absolute, task.original);
		throw new Error(`Task update failed validation and was rolled back: ${JSON.stringify(validation.findings)}`);
	}
	return { path: task.target.relative, validation };
}

function requireDate(value: string, field: string, allowEmpty = true): void {
	if (allowEmpty && value === "") return;
	if (!DATE.test(value)) throw new Error(`${field} must use YYYY-MM-DD`);
}

function appendHistory(document: ReturnType<typeof parseDocument>, action: string, reason?: string): void {
	const history = strings(document.get("recommendation_history"));
	history.push(`${localDate()} | ${action}${reason ? ` | ${reason}` : ""}`);
	document.set("recommendation_history", history);
}

export function updateTask(root: string, input: UpdateTaskInput): OperationResult {
	return writeTask(root, input.path, ({ document }) => {
		if (input.title !== undefined) {
			if (!input.title.trim()) throw new Error("Task title cannot be empty");
			document.set("title", input.title.trim());
		}
		if (input.projects !== undefined) document.set("projects", [...new Set(input.projects.map((item) => item.trim()).filter(Boolean))]);
		if (input.priority !== undefined) {
			if (!PRIORITIES.has(input.priority)) throw new Error("Task priority must be P0..P4");
			document.set("priority", input.priority);
		}
		for (const [field, value] of [["scheduled_for", input.scheduledFor], ["defer_until", input.deferUntil], ["due", input.due]] as const) {
			if (value === undefined) continue;
			requireDate(value, field);
			document.set(field, value);
		}
		if (input.estimateMinutes !== undefined) {
			if (!Number.isInteger(input.estimateMinutes) || input.estimateMinutes < 1) throw new Error("estimateMinutes must be a positive integer");
			document.set("estimate_minutes", input.estimateMinutes);
		}
		if (input.energy !== undefined) document.set("energy", input.energy);
		if (input.workMode !== undefined) document.set("work_mode", input.workMode);
		if (input.growthMode !== undefined) document.set("growth_mode", input.growthMode);
		if (input.scheduledTimes !== undefined) document.set("scheduled_times", [...new Set(input.scheduledTimes)].sort());
	});
}

export function deferTask(root: string, input: DeferTaskInput): OperationResult {
	requireDate(input.deferUntil, "deferUntil", false);
	return writeTask(root, input.path, ({ document }) => {
		if (document.get("status") !== "todo") throw new Error("Only todo Tasks can be deferred");
		document.set("defer_until", input.deferUntil);
		document.set("scheduled_for", "");
		appendHistory(document, `deferred:${input.deferUntil}`, input.reason);
	});
}

export function returnTaskToPool(root: string, input: ReturnTaskToPoolInput): OperationResult {
	return writeTask(root, input.path, ({ document }) => {
		if (["done", "cancelled"].includes(String(document.get("status")))) throw new Error("Completed or cancelled Tasks cannot return to the pool");
		document.set("scheduled_for", "");
		appendHistory(document, "returned_to_pool", input.reason);
	});
}

function poolEntry(root: string, path: string): TaskPoolEntry | undefined {
	const original = readFileSync(path, "utf8");
	const match = FRONTMATTER.exec(original);
	if (!match) return undefined;
	const document = parseDocument(match[1]);
	if (document.errors.length || document.get("type") !== "task") return undefined;
	const legacy = String(document.get("project") ?? "").trim();
	return {
		path: path.slice(resolve(root).length + 1).split("\\").join("/"),
		title: String(document.get("title") ?? ""),
		status: String(document.get("status") ?? "todo"),
		projects: [...new Set([...strings(document.get("projects")), ...(legacy ? [legacy] : [])])],
		priority: String(document.get("priority") ?? "P2"),
		scheduledFor: String(document.get("scheduled_for") ?? ""),
		deferUntil: String(document.get("defer_until") ?? ""),
		due: String(document.get("due") ?? ""),
		estimateMinutes: Number(document.get("estimate_minutes") ?? 30),
		energy: (document.get("energy") ?? "medium") as TaskPoolEntry["energy"],
		workMode: (document.get("work_mode") ?? "shallow") as TaskPoolEntry["workMode"],
		growthMode: (document.get("growth_mode") ?? "neutral") as TaskPoolEntry["growthMode"],
	};
}

export function listTaskPool(root: string, today = localDate()): TaskPoolResult {
	requireDate(today, "today", false);
	const entries = markdownFiles(resolve(root)).map((path) => poolEntry(root, path)).filter((item): item is TaskPoolEntry => item !== undefined);
	const open = entries.filter((task) => !["done", "cancelled"].includes(task.status));
	return {
		today,
		available: open.filter((task) => task.status === "todo" && task.scheduledFor !== today && (!task.deferUntil || task.deferUntil <= today)),
		scheduled: open.filter((task) => task.scheduledFor === today),
		deferred: open.filter((task) => task.status === "todo" && task.deferUntil > today),
		doing: open.filter((task) => task.status === "doing"),
		blocked: open.filter((task) => task.status === "blocked"),
		archiveCandidates: entries.filter((task) => task.status === "done" && task.projects.length > 0 && task.path.startsWith("32_任务/") && !task.path.startsWith(ARCHIVE_PREFIX)),
	};
}

function wikilinkPath(value: string): string {
	const match = /^\[\[([^|#]+)(?:[|#].*)?\]\]$/.exec(value.trim());
	return (match?.[1] ?? value).replace(/\.md$/, "");
}

function projectFile(root: string, reference: string): { absolute: string; relative: string } {
	const requested = wikilinkPath(reference);
	const exact = resolveInsideRoot(root, `${requested}.md`);
	if (existsSync(exact.absolute)) return exact;
	const projectRoot = resolve(root, "31_项目");
	const targetName = `${basename(requested)}.md`;
	const candidates = markdownFiles(projectRoot).filter((path) => basename(path) === targetName);
	const projects = candidates.filter((path) => {
		const match = FRONTMATTER.exec(readFileSync(path, "utf8"));
		if (!match) return false;
		const document = parseDocument(match[1]);
		return !document.errors.length && document.get("type") === "project";
	});
	if (projects.length === 1) return { absolute: projects[0]!, relative: relative(projects[0]!, resolve(root)).split(sep).join("/") };
	if (projects.length > 1) throw new Error(`Linked Project is ambiguous: ${reference}`);
	throw new Error(`Linked Project does not exist: ${reference}`);
}

function appendProjectEvidence(content: string, evidence: string): string {
	const heading = /^## 进展证据\s*$/m.exec(content);
	if (!heading) return `${content.trimEnd()}\n\n## 进展证据\n\n${evidence}\n`;
	const start = (heading.index ?? 0) + heading[0].length;
	const rest = content.slice(start);
	const next = /^## /m.exec(rest);
	const end = next ? start + (next.index ?? 0) : content.length;
	return `${content.slice(0, end).trimEnd()}\n${evidence}\n\n${content.slice(end).replace(/^\s*/, "")}`;
}

export function completeTask(root: string, input: CompleteTaskInput): CompleteTaskResult {
	if (!input.result.trim()) throw new Error("Task completion requires a non-empty result");
	const task = taskDocument(root, input.path);
	const status = String(task.document.get("status") ?? "todo");
	if (!["todo", "doing"].includes(status)) throw new Error(`Task cannot be completed from ${status}`);
	const linked = task.projects.map(wikilinkPath);
	const contributionProjects = input.contributions.map((item) => wikilinkPath(item.project));
	if (linked.length !== contributionProjects.length || linked.some((project) => !contributionProjects.includes(project))) {
		throw new Error(`Task completion requires exactly one contribution assessment for every linked Project: linked=${JSON.stringify(linked)} contributions=${JSON.stringify(contributionProjects)}`);
	}
	for (const contribution of input.contributions) if (!contribution.evidence.trim()) throw new Error("Each Project contribution requires evidence");

	const originals = new Map<string, string>([[task.target.absolute, task.original]]);
	const rendered = new Map<string, string>();
	const today = localDate();
	task.document.set("status", "done");
	task.document.set("completed", today);
	task.document.set("result", input.result.trim());
	task.document.set("outputs", input.outputs ?? []);
	task.document.set("project_contributions", input.contributions.map((item) => `${item.project} | ${item.level} | ${item.evidence.trim()}`));
	task.document.set("scheduled_for", "");
	rendered.set(task.target.absolute, render(task.original, task.match, task.document));

	const projectPaths: string[] = [];
	for (const contribution of input.contributions.filter((item) => item.level !== "incidental")) {
		const target = projectFile(root, contribution.project);
		const original = readFileSync(target.absolute, "utf8");
		originals.set(target.absolute, original);
		rendered.set(target.absolute, appendProjectEvidence(original, `- ${today}：${input.result.trim()}（Task [[${task.target.relative.replace(/\.md$/, "")}]]；贡献 ${contribution.level}；${contribution.evidence.trim()}）`));
		projectPaths.push(target.relative);
	}

	try {
		for (const [path, content] of rendered) atomicWrite(path, content);
		const validation = validateChangedFiles(root, [...rendered.keys()]);
		if (!validation.passed) throw new Error(`Task completion failed validation: ${JSON.stringify(validation.findings)}`);
		return { path: task.target.relative, projectPaths, completed: today, archiveRecommended: task.projects.length > 0 && task.target.relative.startsWith("32_任务/") && !task.target.relative.startsWith(ARCHIVE_PREFIX), validation };
	} catch (error) {
		for (const [path, content] of originals) atomicWrite(path, content);
		throw error;
	}
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function textFiles(root: string): string[] {
	const files: string[] = [];
	const visit = (directory: string): void => {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			if (entry.isDirectory() && [".git", ".obsidian", "framework-backups", "node_modules"].includes(entry.name)) continue;
			const path = resolve(directory, entry.name);
			if (entry.isDirectory()) visit(path);
			else if (entry.isFile() && TEXT_EXTENSIONS.has(extname(path).toLowerCase())) files.push(path);
		}
	};
	visit(resolve(root));
	return files;
}

export function archiveTask(root: string, input: ArchiveTaskInput): ArchiveTaskResult {
	const task = taskDocument(root, input.path);
	if (!task.target.relative.startsWith("32_任务/") || task.target.relative.startsWith(ARCHIVE_PREFIX)) throw new Error("Task is already archived or is outside 32_任务");
	if (task.document.get("status") !== "done") throw new Error("Only completed Tasks can be archived");
	if (task.projects.length === 0) throw new Error("Only Tasks linked to at least one Project are archive candidates");
	const completed = String(task.document.get("completed") ?? "");
	const year = /^\d{4}-\d{2}-\d{2}$/.test(completed) ? completed.slice(0, 4) : localDate().slice(0, 4);
	const destination = resolveInsideRoot(root, `${ARCHIVE_PREFIX}${year}/${basename(task.target.relative)}`);
	if (existsSync(destination.absolute)) throw new Error(`Task archive target already exists: ${destination.relative}`);

	const oldRef = task.target.relative.replace(/\.md$/, "");
	const newRef = destination.relative.replace(/\.md$/, "");
	const rewrites = textFiles(root).filter((path) => path !== task.target.absolute && new RegExp(`${escapeRegExp(oldRef)}(?!/)`).test(readFileSync(path, "utf8")));
	const originals = new Map(rewrites.map((path) => [path, readFileSync(path, "utf8")]));
	try {
		mkdirSync(dirname(destination.absolute), { recursive: true });
		renameSync(task.target.absolute, destination.absolute);
		for (const path of rewrites) atomicWrite(path, originals.get(path)!.replace(new RegExp(`${escapeRegExp(oldRef)}(?!/)`, "g"), newRef));
		const validation = validateChangedFiles(root, [destination.absolute]);
		if (!validation.passed) throw new Error(`Archived Task failed validation: ${JSON.stringify(validation.findings)}`);
		return {
			path: destination.relative,
			fromPath: task.target.relative,
			archived: localDate(),
			rewrittenPaths: rewrites.map((path) => relative(path, resolve(root)).split(sep).join("/")),
			validation,
		};
	} catch (error) {
		if (existsSync(destination.absolute) && !existsSync(task.target.absolute)) {
			mkdirSync(dirname(task.target.absolute), { recursive: true });
			renameSync(destination.absolute, task.target.absolute);
		}
		for (const [path, content] of originals) atomicWrite(path, content);
		throw error;
	}
}
