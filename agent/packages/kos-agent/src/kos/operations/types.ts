import type { ValidationReport } from "../validation/types.ts";

export type CreateObjectKind = "project" | "concept" | "method" | "task" | "source";

export interface ObjectDirectories {
	project: string;
	concept: string;
	method: string;
	task: string;
	source: string;
}

export interface CreateObjectInput {
	kind: CreateObjectKind;
	title: string;
	directories: ObjectDirectories;
	extra?: {
		goal?: string;
		priority?: string;
		format?: string;
	};
}

export interface OperationResult {
	path: string;
	validation: ValidationReport;
}

export interface TransitionStatusInput {
	path: string;
	target: string;
}

export interface TransitionStatusResult extends OperationResult {
	type: string;
	from: string;
	to: string;
}
