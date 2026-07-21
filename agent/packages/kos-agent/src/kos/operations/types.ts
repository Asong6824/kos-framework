import type { ValidationReport } from "../validation/types.ts";

export type CreateObjectKind =
	| "project"
	| "concept"
	| "method"
	| "task"
	| "source"
	| "extract"
	| "summary"
	| "research"
	| "reflection"
	| "personal_operating_profile"
	| "signal"
	| "topic_watch"
	| "company_watch";

export interface ObjectDirectories {
	project: string;
	concept: string;
	method: string;
	task: string;
	source: string;
	extract?: string;
	summary?: string;
	research?: string;
	reflection?: string;
	personal_operating_profile?: string;
	signal?: string;
	topic_watch?: string;
	company_watch?: string;
}

export interface CreateObjectExtra extends Record<string, unknown> {
	goal?: string;
	priority?: string;
	format?: string;
	area?: string;
	category?: string;
	signal_type?: string;
	source?: string;
}

export interface CreateObjectInput {
	kind: CreateObjectKind;
	title: string;
	directories: ObjectDirectories;
	extra?: CreateObjectExtra;
	dryRun?: boolean;
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
