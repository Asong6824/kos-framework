export type ValidationLevel = "ERROR" | "WARN" | "INFO";
export type ValidatorName = "paths" | "schema" | "state" | "skills" | "skill_evals";

export interface ValidationFinding {
	level: ValidationLevel;
	validator: ValidatorName;
	path: string;
	message: string;
}

export interface ValidationReport {
	root: string;
	validatedPaths: string[];
	findings: ValidationFinding[];
	errorCount: number;
	warningCount: number;
	passed: boolean;
}

export interface SchemaRule {
	kind: "string" | "date" | "int" | "bool" | "list" | "enum";
	values?: unknown[];
}

export interface ObjectSchema {
	type: string;
	paths: string[];
	required: Record<string, SchemaRule>;
	optional?: Record<string, SchemaRule>;
}
