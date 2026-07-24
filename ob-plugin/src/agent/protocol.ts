export type KosRpcCommand =
  | { type: 'get_state' }
  | { type: 'get_messages' }
  | { type: 'prompt'; message: string; images?: KosImageContent[]; streamingBehavior?: 'steer' | 'followUp' }
  | { type: 'steer'; message: string; images?: KosImageContent[] }
  | { type: 'follow_up'; message: string; images?: KosImageContent[] }
  | { type: 'abort' }
  | { type: 'new_session'; parentSession?: string }
  | { type: 'validate'; paths?: string[] }
  | ({ type: 'create_object' } & KosCreateObjectInput)
  | ({ type: 'append_reader_extract' } & KosAppendReaderExtractInput)
  | ({ type: 'list_reader_annotations' } & KosListReaderAnnotationsInput)
  | ({ type: 'delete_reader_annotation' } & KosDeleteReaderAnnotationInput)
  | ({ type: 'transition_status' } & KosTransitionStatusInput)
  | ({ type: 'set_goal_weights' } & KosSetGoalWeightsInput)
  | ({ type: 'update_goal' } & KosUpdateGoalInput)
  | { type: 'review_goal_health'; path: string; date?: string }
  | ({ type: 'update_project' } & KosUpdateProjectInput)
  | ({ type: 'update_task' } & KosUpdateTaskInput)
  | { type: 'list_task_pool'; today?: string }
  | ({ type: 'defer_task' } & KosDeferTaskInput)
  | ({ type: 'return_task_to_pool' } & KosReturnTaskToPoolInput)
  | ({ type: 'complete_task' } & KosCompleteTaskInput)
  | ({ type: 'archive_task' } & KosArchiveTaskInput)
  | { type: 'migrate_task_pool'; dryRun?: boolean }
  | ({ type: 'start_day' } & KosStartDayInput)
  | ({ type: 'recommendation_feedback' } & KosRecommendationFeedbackInput)
  | { type: 'end_day' | 'review_week' | 'review_month'; date?: string }
  | { type: 'daily_workflow'; workflow: 'dashboard' | 'brief' | 'diary'; date?: string }
  | { type: 'get_available_models' }
  | { type: 'cycle_thinking_level' }
  | { type: 'get_session_stats' }
  | { type: 'list_sessions'; query?: string }
  | { type: 'switch_session'; sessionPath: string }
  | { type: 'set_session_name'; name: string }
  | { type: 'compact'; customInstructions?: string }
  | { type: 'clone' }
  | { type: 'get_fork_messages' }
  | { type: 'fork'; entryId: string }
  | { type: 'get_tree' }
  | { type: 'get_commands' }
  | { type: 'set_model'; provider: string; modelId: string }
  | ({ type: 'configure_model' } & KosConfigureModelInput)
  | { type: 'configure_web_search'; provider: 'brave' | 'exa'; apiKey: string }
  | { type: 'get_web_search_state' };

export type KosModelApi =
  | 'openai-responses'
  | 'openai-completions'
  | 'anthropic-messages'
  | 'google-generative-ai';

export interface KosConfigureModelInput {
  provider: string;
  modelId: string;
  apiKey: string;
  baseUrl?: string;
  api?: KosModelApi;
}

export interface KosModelInfo {
  provider: string;
  id: string;
  name?: string;
  reasoning?: boolean;
  contextWindow?: number;
  maxTokens?: number;
}

export interface KosCreateObjectInput {
  kind: 'goal' | 'project' | 'concept' | 'method' | 'task' | 'source';
  title: string;
  directories: { goal?: string; project: string; concept: string; method: string; task: string; source: string };
  extra?: {
    goal?: string; priority?: string; format?: string; period?: string; allocation_weight?: number; metric?: string[];
    primary_goal?: string; goal_alignment?: string; process_metric?: string[]; result_metric?: string[];
    projects?: string[]; estimate_minutes?: number; energy?: string; work_mode?: string; growth_mode?: string;
  };
}

export interface KosOperationResult {
  path: string;
  validation: KosValidationReport;
}

export interface KosObjectDirectories {
  project: string;
  concept: string;
  method: string;
  task: string;
  source: string;
  extract?: string;
  summary?: string;
  research?: string;
  reflection?: string;
}

export interface KosAppendReaderExtractInput {
  sourcePath: string;
  documentPath: string;
  kind: 'markdown' | 'pdf' | 'epub';
  location: string;
  positionLabel: string;
  text: string;
  note?: string;
  color?: KosReaderAnnotationColor;
  anchor?: KosReaderAnchor;
  directories: KosObjectDirectories;
}

export interface KosAppendReaderExtractResult extends KosOperationResult {
  extractId: string;
  created: boolean;
  duplicate: boolean;
  annotation: KosReaderAnnotation;
}

export type KosReaderAnnotationColor = 'yellow' | 'red' | 'blue' | 'green';
export interface KosReaderRect { x: number; y: number; width: number; height: number }
export type KosReaderAnchor =
  | { format: 'pdf'; page: number; rects: KosReaderRect[]; quote: string }
  | { format: 'epub'; cfiRange: string; quote: string }
  | { format: 'markdown'; quote: string; occurrence?: number };
export interface KosReaderAnnotation {
  id: string;
  sourcePath: string;
  documentPath: string;
  extractPath: string;
  kind: 'markdown' | 'pdf' | 'epub';
  location: string;
  positionLabel: string;
  text: string;
  note: string;
  color: KosReaderAnnotationColor;
  anchor: KosReaderAnchor;
  createdAt: string;
  updatedAt: string;
}
export interface KosListReaderAnnotationsInput { sourcePath: string }
export interface KosListReaderAnnotationsResult { extractPath: string | null; annotations: KosReaderAnnotation[] }
export interface KosDeleteReaderAnnotationInput { sourcePath: string; extractId: string }
export interface KosDeleteReaderAnnotationResult extends KosOperationResult { extractId: string; deleted: true }

export interface KosTransitionStatusInput {
  path: string;
  target: string;
  humanConfirmed?: boolean;
  reason?: string;
  unblockCondition?: string;
}

export interface KosTransitionStatusResult extends KosOperationResult {
  type: string;
  from: string;
  to: string;
}

export interface KosSetGoalWeightsInput {
  period: string;
  changes: Array<{
    path: string;
    allocationWeight?: number;
    targetStatus?: 'active' | 'paused' | 'achieved' | 'abandoned' | 'archived';
  }>;
  humanConfirmed: boolean;
}

export interface KosSetGoalWeightsResult {
  period: string;
  activeTotal: number;
  changedPaths: string[];
  validation: KosValidationReport;
}
export interface KosUpdateGoalInput {
  path: string; title?: string; health?: 'unknown' | 'on_track' | 'at_risk' | 'off_track'; expectedResults?: string[]; metrics?: string[];
  notDoing?: string[]; constraints?: string[]; appendEvidence?: string[]; humanConfirmed?: boolean;
}
export interface KosGoalHealthReview { path: string; current: string; suggested: 'unknown' | 'on_track' | 'at_risk' | 'off_track'; reasons: string[]; evidenceCount: number; requiresConfirmation: true }

export interface KosProjectMetric {
  id: string; kind: 'process' | 'result'; name: string; unit: string; baseline: number; target: number; current: number; updated: string; evidence: string[];
}
export interface KosUpdateProjectInput {
  query: string; status?: string; currentStage?: string; nextMilestone?: string; due?: string; primaryGoal?: string; supportingGoals?: string[];
  goalAlignment?: 'direct' | 'enabling' | 'exploratory' | 'off_goal' | 'conflicting'; alignmentReviewed?: string; explorationReviewDue?: string;
  metrics?: KosProjectMetric[]; metricUpdates?: Array<{ id: string; current: number; evidence: string }>;
  offGoalOverride?: boolean; overrideReason?: string; overrideReviewDue?: string; validationCompleted?: boolean; expectedResultAchieved?: boolean;
  progress?: string[]; decisions?: string[]; reviews?: string[];
}

export interface KosUpdateTaskInput {
  path: string;
  title?: string;
  projects?: string[];
  priority?: string;
  scheduledFor?: string;
  deferUntil?: string;
  due?: string;
  estimateMinutes?: number;
  energy?: 'low' | 'medium' | 'high';
  workMode?: 'deep' | 'shallow' | 'collaborative' | 'administrative';
  growthMode?: 'neutral' | 'practice' | 'stretch';
  scheduledTimes?: string[];
}

export interface KosTaskPoolEntry {
  path: string;
  title: string;
  status: string;
  projects: string[];
  priority: string;
  scheduledFor: string;
  deferUntil: string;
  due: string;
  estimateMinutes: number;
  energy: 'low' | 'medium' | 'high';
  workMode: 'deep' | 'shallow' | 'collaborative' | 'administrative';
  growthMode: 'neutral' | 'practice' | 'stretch';
}

export interface KosTaskPoolResult {
  today: string;
  available: KosTaskPoolEntry[];
  scheduled: KosTaskPoolEntry[];
  deferred: KosTaskPoolEntry[];
  doing: KosTaskPoolEntry[];
  blocked: KosTaskPoolEntry[];
  archiveCandidates: KosTaskPoolEntry[];
}

export interface KosDeferTaskInput { path: string; deferUntil: string; reason?: string }
export interface KosReturnTaskToPoolInput { path: string; reason?: string }
export interface KosTaskContributionInput { project: string; level: 'strong' | 'supporting' | 'incidental'; evidence: string }
export interface KosCompleteTaskInput { path: string; result: string; outputs?: string[]; contributions: KosTaskContributionInput[] }
export interface KosCompleteTaskResult extends KosOperationResult { projectPaths: string[]; completed: string; archiveRecommended: boolean }
export interface KosArchiveTaskInput { path: string }
export interface KosArchiveTaskResult extends KosOperationResult { fromPath: string; archived: string; rewrittenPaths: string[] }

export type KosRecommendationStatus = 'recommended' | 'accepted' | 'adjusted' | 'deferred' | 'rejected';
export interface KosCapabilityFocusSummary { period: string; name: string; behavior: string; appliesTo: string[]; maxDailyRecommendations: number }
export interface KosPlanningGoal { path: string; title: string; weight: number; health: string; recentMinutes: number; recentShare: number; allocationDelta: number }
export interface KosPlanningProject { path: string; title: string; status: string; alignment: string; goals: string[]; nextMilestone: string; due: string }
export interface KosPlanningContext {
  date: string; period: string; goals: KosPlanningGoal[]; projects: KosPlanningProject[]; taskPool: KosTaskPoolResult;
  yesterdayUnfinished: string[]; constraints: { availableMinutes?: number; energy?: 'low' | 'medium' | 'high'; hardConstraints: string[] };
  capabilityFocus?: KosCapabilityFocusSummary; validatorFindings: Array<{ level: string; path: string; message: string }>; fingerprint: string;
}
export interface KosDailyRecommendation {
  id: string; taskPath: string; title: string; status: KosRecommendationStatus; reason: string; goals: string[]; projects: string[];
  estimateMinutes: number; tradeoff: string; capabilityFocusUsed: boolean;
}
export interface KosStartDayInput { date?: string; availableMinutes?: number; energy?: 'low' | 'medium' | 'high'; hardConstraints?: string[] }
export interface KosStartDayResult extends KosOperationResult { runId: string; context: KosPlanningContext; recommendations: KosDailyRecommendation[] }
export interface KosRecommendationFeedbackInput {
  date: string; runId: string; recommendationId: string; action: Exclude<KosRecommendationStatus, 'recommended'>;
  reason?: string; deferUntil?: string; estimateMinutes?: number;
}
export interface KosReviewResult extends KosOperationResult {
  period: string;
  summary: { goalEffort: KosPlanningGoal[]; repeatedlyDeferred: string[]; offGoalProjects: string[]; capabilityEvidence: string[] };
}
export interface KosTaskMigrationResult { scanned: number; changedPaths: string[]; validation: KosValidationReport }

export interface KosRpcState {
  protocolVersion: 1;
  model?: KosModelInfo;
  thinkingLevel: string;
  isStreaming: boolean;
  sessionFile?: string;
  sessionId: string;
  sessionName?: string;
  messageCount: number;
  pendingMessageCount: number;
}

export interface KosSessionInfo {
  path: string;
  id: string;
  cwd: string;
  name?: string;
  parentSessionPath?: string;
  created: string;
  modified: string;
  messageCount: number;
  firstMessage: string;
  allMessagesText: string;
}

export interface KosForkMessage {
  entryId: string;
  text: string;
}

export interface KosSessionTreeNode {
  entry: { id: string; type: string; timestamp?: string; [key: string]: unknown };
  children: KosSessionTreeNode[];
  label?: string;
  labelTimestamp?: string;
}

export interface KosSlashCommand {
  name: string;
  description?: string;
  source: 'extension' | 'prompt' | 'skill';
  sourceInfo?: { path?: string; [key: string]: unknown };
}

export interface KosSessionStats {
  sessionId: string;
  totalMessages: number;
  toolCalls: number;
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
  cost: number;
  contextUsage?: { tokens: number | null; contextWindow: number; percent: number | null };
}

export interface KosContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  name?: string;
  arguments?: unknown;
}

export interface KosImageContent {
  type: 'image';
  data: string;
  mimeType: string;
}

export interface KosMessage {
  role: string;
  content?: string | KosContentBlock[];
  errorMessage?: string;
}

export interface KosToolResult {
  content?: KosContentBlock[];
  details?: {
    diff?: string;
    patch?: string;
    firstChangedLine?: number;
    validation?: KosValidationReport;
    [key: string]: unknown;
  };
}

export interface KosValidationReport {
  validatedPaths: string[];
  findings: Array<{
    level: 'ERROR' | 'WARN' | 'INFO';
    validator: 'paths' | 'schema' | 'state' | string;
    path: string;
    message: string;
  }>;
  errorCount: number;
  warningCount: number;
  passed: boolean;
}

export type KosRpcEvent =
  | { type: 'agent_start' | 'agent_end' | 'agent_settled' }
  | { type: 'message_start' | 'message_update' | 'message_end'; message: KosMessage }
  | { type: 'tool_execution_start'; toolCallId: string; toolName: string; args: unknown }
  | { type: 'tool_execution_update'; toolCallId: string; toolName: string; args: unknown; partialResult: unknown }
  | {
      type: 'tool_execution_end';
      toolCallId: string;
      toolName: string;
      result: KosToolResult;
      isError: boolean;
    }
  | {
      type: 'extension_ui_request';
      id: string;
      method: 'select' | 'confirm' | 'input' | 'editor' | 'notify' | string;
      title?: string;
      message?: string;
      placeholder?: string;
      prefill?: string;
      options?: string[];
      notifyType?: 'info' | 'warning' | 'error';
    };

export function messageText(message: KosMessage): string {
  if (typeof message.content === 'string') return message.content;
  if (!Array.isArray(message.content)) return message.errorMessage ?? '';
  const text = message.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('');
  return text || message.errorMessage || '';
}

export function messageThinking(message: KosMessage): string {
  if (!Array.isArray(message.content)) return '';
  return message.content
    .filter((block) => block.type === 'thinking')
    .map((block) => block.thinking ?? block.text ?? '')
    .join('');
}
