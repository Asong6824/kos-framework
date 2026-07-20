import { readFileSync } from "node:fs";
import { parseDocument } from "yaml";
import { validateChangedFiles } from "../validation/validate.ts";
import { atomicWrite, resolveInsideRoot } from "./files.ts";
import { legalTargets, STATE_MACHINES } from "./state-machines.ts";
import type { TransitionStatusInput, TransitionStatusResult } from "./types.ts";

function localDate(): string {
	const now = new Date();
	return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function transitionStatus(root: string, input: TransitionStatusInput): TransitionStatusResult {
	const target = resolveInsideRoot(root, input.path);
	const original = readFileSync(target.absolute, "utf8");
	const match = /^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/.exec(original);
	if (!match) throw new Error(`Object has no frontmatter: ${target.relative}`);
	const document = parseDocument(match[1]);
	if (document.errors.length) throw new Error(`Object frontmatter is invalid: ${document.errors[0].message}`);
	const type = String(document.get("type") ?? "");
	const machine = STATE_MACHINES[type];
	if (!machine) throw new Error(`Object type has no state machine: ${type || "<missing>"}`);
	const rawCurrent = document.get(machine.field);
	const current = machine.field === "reviewed" ? String(Boolean(rawCurrent)) : String(rawCurrent ?? "");
	if (!legalTargets(type, current).includes(input.target)) {
		throw new Error(`Illegal ${type} transition: ${current} -> ${input.target}`);
	}
	if (type === "method") {
		const count = Number(document.get("validated_times") ?? 0);
		if (input.target === "usable" && count < 1) throw new Error("method -> usable requires validated_times >= 1");
		if (input.target === "trusted" && count < 3) throw new Error("method -> trusted requires validated_times >= 3");
	}
	const value: string | boolean = machine.field === "reviewed" ? input.target === "true" : input.target;
	document.set(machine.field, value);
	const today = localDate();
	if (document.has("updated")) document.set("updated", today);
	if (type === "task" && input.target === "done") document.set("completed", today);
	const updated = `---\n${document.toString().trim()}\n---\n${original.slice(match[0].length)}`;
	atomicWrite(target.absolute, updated);
	const validation = validateChangedFiles(root, [target.absolute]);
	if (!validation.passed) {
		atomicWrite(target.absolute, original);
		throw new Error(`Transition failed validation and was rolled back: ${JSON.stringify(validation.findings)}`);
	}
	return { path: target.relative, type, from: current, to: input.target, validation };
}
