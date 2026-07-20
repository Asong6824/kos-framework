import { renameSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";

export function resolveInsideRoot(root: string, path: string): { absolute: string; relative: string } {
	const resolvedRoot = resolve(root);
	const absolute = resolve(resolvedRoot, path);
	const rel = relative(resolvedRoot, absolute);
	if (rel === ".." || rel.startsWith(`..${sep}`)) throw new Error(`Path escapes vault root: ${path}`);
	return { absolute, relative: rel.split(sep).join("/") };
}

export function atomicWrite(path: string, content: string): void {
	const temporary = resolve(dirname(path), `.${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`);
	writeFileSync(temporary, content, "utf8");
	renameSync(temporary, path);
}
