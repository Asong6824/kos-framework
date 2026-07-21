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
  | ({ type: 'transition_status' } & KosTransitionStatusInput)
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
  kind: 'project' | 'concept' | 'method' | 'task' | 'source';
  title: string;
  directories: { project: string; concept: string; method: string; task: string; source: string };
  extra?: { goal?: string; priority?: string; format?: string };
}

export interface KosOperationResult {
  path: string;
  validation: KosValidationReport;
}

export interface KosTransitionStatusInput {
  path: string;
  target: string;
}

export interface KosTransitionStatusResult extends KosOperationResult {
  type: string;
  from: string;
  to: string;
}

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
