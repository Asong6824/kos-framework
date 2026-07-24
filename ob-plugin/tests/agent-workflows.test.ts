import { describe, expect, it } from 'vitest';
import { buildDashboardAgentCommand, dashboardSkillForIntent, dashboardWorkflowSessionName } from '../src/agent/workflows';

const context = {
  selectedObjects: [{ path: '32_任务/示例.md' }],
  intent: 'complete-task',
};

describe('dashboard Agent workflow routing', () => {
  it('routes daily and period workflows through their LLM Skills', () => {
    expect(dashboardSkillForIntent('prioritize-today')).toBe('kos-start-my-day');
    expect(dashboardSkillForIntent('end-day')).toBe('kos-end-my-day');
    expect(dashboardSkillForIntent('review-week')).toBe('kos-review-period');
    expect(dashboardSkillForIntent('review-month')).toBe('kos-review-period');
    expect(dashboardSkillForIntent('process-sources')).toBe('kos-process-source');
    expect(dashboardSkillForIntent('review-object')).toBe('kos-revise-object');
  });

  it('routes Goal, Project, and Task management through domain Skills', () => {
    const expected = {
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
    } as const;
    for (const [intent, skill] of Object.entries(expected)) expect(dashboardSkillForIntent(intent)).toBe(skill);
  });

  it('keeps only the action, meaningful input, and non-empty object context', () => {
    const command = buildDashboardAgentCommand(context, { result: '完成交付' });
    expect(command).toBe([
      '/kos-manage-task',
      '操作：complete-task',
      '参数：{"result":"完成交付"}',
      '对象：32_任务/示例.md',
    ].join('\n\n'));
  });

  it('omits routing metadata, duplicate context, and empty values from start-day prompts', () => {
    const command = buildDashboardAgentCommand({
      selectedObjects: [],
      intent: 'prioritize-today',
    }, {
      availableMinutes: 120,
      energy: 'medium',
      hardConstraints: [],
      date: '2026-07-23',
    });
    expect(command).toBe('/kos-start-my-day\n\n参数：{"availableMinutes":120,"energy":"medium","date":"2026-07-23"}');
    expect(command).not.toMatch(/module|view|filters|selectedObjects|activeFile|intent|LLM|Harness/);
  });

  it('keeps only object paths and uses an isolated workflow session label', () => {
    const command = buildDashboardAgentCommand({
      selectedObjects: [{ path: '30_目标/2026-H2/目标A.md' }, { path: '30_目标/2026-H2/目标B.md' }],
      intent: 'adjust-goal-weights',
    }, { period: '2026-H2' });
    expect(command).toContain('对象：["30_目标/2026-H2/目标A.md","30_目标/2026-H2/目标B.md"]');
    expect(command).not.toMatch(/module|view|filters|selectedObjects|activeFile|title|type/);
    expect(dashboardWorkflowSessionName('review-week', { date: '2026-07-24' }))
      .toBe('看板 · review-week · 2026-07-24');
  });

  it('rejects an unmapped dashboard intent instead of sending a generic prompt', () => {
    expect(() => buildDashboardAgentCommand({ selectedObjects: [], intent: 'unknown-action' }))
      .toThrow('看板操作未配置 Agent Skill：unknown-action');
  });
});
