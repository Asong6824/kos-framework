export interface DashboardWorkflowContext {
  selectedObjects: Array<{ path: string }>;
  intent: string;
}

const SKILL_BY_INTENT: Record<string, string> = {
  'prioritize-today': 'kos-start-my-day',
  'end-day': 'kos-end-my-day',
  'review-week': 'kos-review-period',
  'review-month': 'kos-review-period',
  'create-goal': 'kos-plan-half-year',
  'update-goal': 'kos-plan-half-year',
  'adjust-goal-weights': 'kos-plan-half-year',
  'goal-status': 'kos-plan-half-year',
  'goal-transition': 'kos-plan-half-year',
  'review-goal': 'kos-plan-half-year',
  'create-project': 'kos-create-project',
  'update-project': 'kos-update-project',
  'project-status': 'kos-update-project',
  'project-transition': 'kos-update-project',
  'create-task': 'kos-manage-task',
  'update-task': 'kos-manage-task',
  'schedule-task': 'kos-manage-task',
  'defer-task': 'kos-manage-task',
  'return-task-to-pool': 'kos-manage-task',
  'block-task': 'kos-manage-task',
  'complete-task': 'kos-manage-task',
  'archive-task': 'kos-manage-task',
  'task-status': 'kos-manage-task',
  'task-transition': 'kos-manage-task',
  'resolve-blocker': 'kos-manage-task',
  'process-sources': 'kos-process-source',
  'review-object': 'kos-revise-object',
};

export function dashboardSkillForIntent(intent: string): string | null {
  return SKILL_BY_INTENT[intent] ?? null;
}

function compactValue(value: unknown): unknown | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') return value.trim() ? value : undefined;
  if (Array.isArray(value)) {
    const items = value.map(compactValue).filter((item) => item !== undefined);
    return items.length ? items : undefined;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => [key, compactValue(item)] as const)
      .filter((entry): entry is readonly [string, unknown] => entry[1] !== undefined);
    return entries.length ? Object.fromEntries(entries) : undefined;
  }
  return value;
}

function skillNeedsIntent(skill: string): boolean {
  return Object.values(SKILL_BY_INTENT).filter((candidate) => candidate === skill).length > 1;
}

export function buildDashboardAgentCommand(
  context: DashboardWorkflowContext,
  input?: Record<string, unknown>,
): string {
  const skill = dashboardSkillForIntent(context.intent);
  if (!skill) throw new Error(`看板操作未配置 Agent Skill：${context.intent}`);
  const parameters = compactValue(input);
  const objectPaths = context.selectedObjects.map((object) => object.path);
  const objects = objectPaths.length === 1 ? objectPaths[0] : compactValue(objectPaths);
  return [
    `/${skill}`,
    skillNeedsIntent(skill) ? `操作：${context.intent}` : '',
    parameters ? `参数：${JSON.stringify(parameters)}` : '',
    objects ? `对象：${typeof objects === 'string' ? objects : JSON.stringify(objects)}` : '',
  ].filter(Boolean).join('\n\n');
}

export function dashboardWorkflowSessionName(intent: string, input?: Record<string, unknown>): string {
  const date = typeof input?.date === 'string' && input.date.trim() ? ` · ${input.date.trim()}` : '';
  return `看板 · ${intent}${date}`;
}
