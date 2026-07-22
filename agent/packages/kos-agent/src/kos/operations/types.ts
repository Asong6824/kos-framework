import type { ValidationReport } from "../validation/types.ts";

export type CreateObjectKind =
	| "goal"
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
	goal?: string;
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

export interface AppendReaderExtractInput {
	sourcePath: string;
	documentPath: string;
	kind: "markdown" | "pdf" | "epub";
	location: string;
	positionLabel: string;
	text: string;
	directories: ObjectDirectories;
}

export interface AppendReaderExtractResult extends OperationResult {
	extractId: string;
	created: boolean;
	duplicate: boolean;
}

export interface TransitionStatusInput {
	path: string;
	target: string;
	humanConfirmed?: boolean;
	reason?: string;
	unblockCondition?: string;
}

export interface TransitionStatusResult extends OperationResult {
	type: string;
	from: string;
	to: string;
}

export interface GoalWeightChange {
	path: string;
	allocationWeight?: number;
	targetStatus?: "active" | "paused" | "achieved" | "abandoned" | "archived";
}

export interface SetGoalWeightsInput {
	period: string;
	changes: GoalWeightChange[];
	humanConfirmed: boolean;
}

export interface SetGoalWeightsResult {
	period: string;
	activeTotal: number;
	changedPaths: string[];
	validation: ValidationReport;
}

export interface UpdateGoalInput {
	path: string;
	title?: string;
	health?: "unknown" | "on_track" | "at_risk" | "off_track";
	expectedResults?: string[];
	metrics?: string[];
	notDoing?: string[];
	constraints?: string[];
	appendEvidence?: string[];
	humanConfirmed?: boolean;
}

export interface GoalHealthReview {
	path: string;
	current: string;
	suggested: "unknown" | "on_track" | "at_risk" | "off_track";
	reasons: string[];
	evidenceCount: number;
	requiresConfirmation: true;
}

export type TaskEnergy = "low" | "medium" | "high";
export type TaskWorkMode = "deep" | "shallow" | "collaborative" | "administrative";
export type TaskGrowthMode = "neutral" | "practice" | "stretch";
export type TaskContributionLevel = "strong" | "supporting" | "incidental";

export interface UpdateTaskInput {
	path: string;
	title?: string;
	projects?: string[];
	priority?: string;
	scheduledFor?: string;
	deferUntil?: string;
	due?: string;
	estimateMinutes?: number;
	energy?: TaskEnergy;
	workMode?: TaskWorkMode;
	growthMode?: TaskGrowthMode;
	scheduledTimes?: string[];
}

export interface TaskPoolEntry {
	path: string;
	title: string;
	status: string;
	projects: string[];
	priority: string;
	scheduledFor: string;
	deferUntil: string;
	due: string;
	estimateMinutes: number;
	energy: TaskEnergy;
	workMode: TaskWorkMode;
	growthMode: TaskGrowthMode;
}

export interface TaskPoolResult {
	today: string;
	available: TaskPoolEntry[];
	scheduled: TaskPoolEntry[];
	deferred: TaskPoolEntry[];
	doing: TaskPoolEntry[];
	blocked: TaskPoolEntry[];
	archiveCandidates: TaskPoolEntry[];
}

export interface DeferTaskInput {
	path: string;
	deferUntil: string;
	reason?: string;
}

export interface ReturnTaskToPoolInput {
	path: string;
	reason?: string;
}

export interface TaskContributionInput {
	project: string;
	level: TaskContributionLevel;
	evidence: string;
}

export interface CompleteTaskInput {
	path: string;
	result: string;
	outputs?: string[];
	contributions: TaskContributionInput[];
}

export interface CompleteTaskResult extends OperationResult {
	projectPaths: string[];
	completed: string;
	archiveRecommended: boolean;
}

export interface ArchiveTaskInput {
	path: string;
}

export interface ArchiveTaskResult extends OperationResult {
	fromPath: string;
	archived: string;
	rewrittenPaths: string[];
}

export interface ProjectDirectoryMove {
	from: string;
	to: string;
	state: "move" | "already_canonical" | "conflict";
}

export interface ProjectDirectoryMigrationResult {
	dryRun: boolean;
	applied: boolean;
	scanned: number;
	moves: ProjectDirectoryMove[];
	rewrittenPaths: string[];
	conflicts: string[];
	backupPath?: string;
	validation: ValidationReport;
}

export interface TaskMigrationResult {
	scanned: number;
	changedPaths: string[];
	validation: ValidationReport;
}

export interface LayoutMove {
	key: string;
	from: string;
	to: string;
	state: "move" | "create" | "already_migrated" | "conflict";
	fileCount: number;
}

export interface LayoutMigrationResult {
	fromVersion: number;
	toVersion: number;
	dryRun: boolean;
	applied: boolean;
	moves: LayoutMove[];
	rewrittenPaths: string[];
	conflicts: string[];
	backupPath?: string;
}

export type RecommendationStatus = "recommended" | "accepted" | "adjusted" | "deferred" | "rejected";

export interface CapabilityFocusSummary {
	period: string;
	name: string;
	behavior: string;
	appliesTo: string[];
	maxDailyRecommendations: number;
}

export interface PlanningGoal {
	path: string;
	title: string;
	weight: number;
	health: string;
	recentMinutes: number;
	recentShare: number;
	allocationDelta: number;
}

export interface PlanningProject {
	path: string;
	title: string;
	status: string;
	alignment: string;
	goals: string[];
	nextMilestone: string;
	due: string;
}

export interface PlanningContext {
	date: string;
	period: string;
	goals: PlanningGoal[];
	projects: PlanningProject[];
	taskPool: TaskPoolResult;
	yesterdayUnfinished: string[];
	constraints: { availableMinutes?: number; energy?: TaskEnergy; hardConstraints: string[] };
	capabilityFocus?: CapabilityFocusSummary;
	validatorFindings: Array<{ level: string; path: string; message: string }>;
	fingerprint: string;
}

export interface DailyRecommendation {
	id: string;
	taskPath: string;
	title: string;
	status: RecommendationStatus;
	reason: string;
	goals: string[];
	projects: string[];
	estimateMinutes: number;
	tradeoff: string;
	capabilityFocusUsed: boolean;
}

export interface StartDayInput {
	date?: string;
	availableMinutes?: number;
	energy?: TaskEnergy;
	hardConstraints?: string[];
}

export interface StartDayResult extends OperationResult {
	runId: string;
	context: PlanningContext;
	recommendations: DailyRecommendation[];
}

export interface RecommendationFeedbackInput {
	date: string;
	runId: string;
	recommendationId: string;
	action: Exclude<RecommendationStatus, "recommended">;
	reason?: string;
	deferUntil?: string;
	estimateMinutes?: number;
}

export interface ReviewResult extends OperationResult {
	period: string;
	summary: {
		goalEffort: PlanningGoal[];
		repeatedlyDeferred: string[];
		offGoalProjects: string[];
		capabilityEvidence: string[];
	};
}
