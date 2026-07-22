import { App, TFile, normalizePath } from 'obsidian';
import type { CreateExtra, CreateKind, CreateObjectOperation } from './create';
import { ensureFolder } from './create';
import type { SetGoalWeightsOperation, UpdateGoalOperation } from './goals';
import type { TaskOperations } from './tasks';
import type { TransitionOperation } from './transition';
import type { UpdateProjectOperation } from './projects';
import type { KosCompleteTaskInput, KosSetGoalWeightsInput, KosUpdateProjectInput, KosUpdateTaskInput } from '../agent/protocol';
import type { ObjectDirs } from '../core/model';

const today = (): string => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

const quote = (value: string): string => JSON.stringify(value);
const list = (values: string[] = []): string => `[${values.map(quote).join(', ')}]`;
const safeName = (value: string): string => value.trim().replace(/[\\/:*?"<>|#[\]]+/g, ' ').replace(/\s+/g, ' ').trim();

function body(kind: CreateKind, title: string): string {
  if (kind === 'goal') return `# ${title}\n\n## 为什么重要\n\n## 期望结果\n\n## 量化指标\n\n## 不做什么\n\n## 约束与代价\n\n## 关联项目\n\n## 进展证据\n\n## 风险与偏差\n\n## 复盘记录\n`;
  if (kind === 'project') return `# ${title}\n\n## 背景与策略假设\n\n## 与当前目标的关系\n\n## 过程指标\n\n## 结果指标\n\n## 当前阶段与下一里程碑\n\n## 决策日志\n\n## 进展证据\n\n## 阻塞与风险\n\n## 阶段性复盘\n\n## 最终成果\n\n## 最终结论与沉淀\n`;
  return `# ${title}\n\n## 完成定义\n\n- \n\n## 执行记录\n\n- \n`;
}

export function vaultCreateOperation(app: App): CreateObjectOperation {
  return async (kind: CreateKind, title: string, dirs: ObjectDirs, extra: CreateExtra) => {
    const name = safeName(title);
    if (!name) throw new Error('标题不能为空');
    if (!['goal', 'project', 'task'].includes(kind)) throw new Error('Agent 离线时仅支持直接创建 Goal、Project 和 Task');
    if (kind === 'project' && !(extra.process_metric?.length || extra.result_metric?.length)) throw new Error('Project 至少需要一个量化过程指标或结果指标');
    const period = extra.period ?? `${new Date().getFullYear()}-${new Date().getMonth() < 6 ? 'H1' : 'H2'}`;
    if (kind === 'goal' && !/^\d{4}-H[12]$/.test(period)) throw new Error('Goal 周期必须使用 YYYY-H1 或 YYYY-H2');
    const directory = kind === 'goal' ? `${dirs.goal ?? '30_目标'}/${period}` : kind === 'project' ? `${dirs.project}/${name}` : dirs.task;
    await ensureFolder(app, directory);
    const path = normalizePath(`${directory}/${name}.md`);
    if (await app.vault.adapter.exists(path)) throw new Error(`对象已存在：${path}`);
    const date = today();
    const frontmatter = kind === 'goal' ? [
      'type: goal', `title: ${quote(name)}`, `horizon: ${period.endsWith('H1') ? 'H1' : 'H2'}`, `period: ${period}`, 'status: draft',
      `allocation_weight: ${Number(extra.allocation_weight ?? 0)}`, 'health: unknown', `period_start: ${period.slice(0, 4)}-${period.endsWith('H1') ? '01-01' : '07-01'}`,
      `period_end: ${period.slice(0, 4)}-${period.endsWith('H1') ? '06-30' : '12-31'}`, `created: ${date}`, `updated: ${date}`, 'human_confirmed: false', 'result_evidence: []', 'weight_history: []', 'tags: [goal]',
    ] : kind === 'project' ? [
      'type: project', `title: ${quote(name)}`, 'status: idea', 'category: other', `priority: ${extra.priority ?? 'P2'}`,
      `primary_goal: ${quote(extra.primary_goal ?? '')}`, 'supporting_goals: []', `goal_alignment: ${extra.goal_alignment ?? 'off_goal'}`, `alignment_reviewed: ${date}`,
      'exploration_review_due: ""', `process_metrics: ${list(extra.process_metric)}`, `result_metrics: ${list(extra.result_metric)}`, 'current_stage: ""', 'next_milestone: ""',
      'due: ""', `created: ${date}`, `updated: ${date}`, 'blocked_reason: ""', 'unblock_condition: ""', 'off_goal_override: false', 'override_review_due: ""', 'tags: [project]',
    ] : [
      'type: task', `title: ${quote(name)}`, 'status: todo', `projects: ${list(extra.projects)}`, `priority: ${extra.priority ?? 'P2'}`, 'scheduled_for: ""', 'defer_until: ""', 'due: ""',
      `estimate_minutes: ${Number(extra.estimate_minutes ?? 30)}`, `energy: ${extra.energy ?? 'medium'}`, `work_mode: ${extra.work_mode ?? 'shallow'}`, `growth_mode: ${extra.growth_mode ?? 'neutral'}`,
      'scheduled_times: []', `created: ${date}`, 'completed: ""', 'result: ""', 'outputs: []', 'blocked_reason: ""', 'unblock_condition: ""', 'project_contributions: []', 'recommendation_history: []', 'tags: []',
    ];
    await app.vault.create(path, `---\n${frontmatter.join('\n')}\n---\n${body(kind, name)}`);
    return path;
  };
}

async function file(app: App, path: string): Promise<TFile> {
  const found = app.vault.getAbstractFileByPath(path);
  if (!(found instanceof TFile)) throw new Error(`文件不存在：${path}`);
  return found;
}

export function vaultTransitionOperation(app: App): TransitionOperation {
  return async (path, target, humanConfirmed, reason, unblockCondition) => {
    const targetFile = await file(app, path);
    await app.fileManager.processFrontMatter(targetFile, (fm) => {
      if (fm.type === 'goal' && ['active', 'paused', 'achieved', 'abandoned'].includes(target) && !humanConfirmed) throw new Error('Goal 状态变化需要用户确认');
      if (fm.type === 'task' && target === 'done') throw new Error('Task 完成必须通过完成表单记录结果和贡献');
      fm.status = target;
      if (target === 'blocked') {
        if (!reason?.trim() || !unblockCondition?.trim()) throw new Error('阻塞必须填写原因和解除条件');
        fm.blocked_reason = reason.trim(); fm.unblock_condition = unblockCondition.trim();
      }
      if (target !== 'blocked' && fm.type === 'task') { fm.blocked_reason = ''; fm.unblock_condition = ''; }
      if ('updated' in fm) fm.updated = today();
      if (fm.type === 'goal') fm.human_confirmed = humanConfirmed === true;
    });
    return true;
  };
}

export function vaultGoalWeightsOperation(app: App): SetGoalWeightsOperation {
  return async (input: KosSetGoalWeightsInput) => {
    if (!input.humanConfirmed) throw new Error('Goal 权重变化需要用户确认');
    const goals = input.changes.map((change) => ({ change, file: app.vault.getAbstractFileByPath(change.path) })).filter((item): item is { change: KosSetGoalWeightsInput['changes'][number]; file: TFile } => item.file instanceof TFile);
    if (goals.length !== input.changes.length) throw new Error('部分 Goal 文件不存在');
    const activeTotal = input.changes.reduce((sum, { allocationWeight = 0, targetStatus }) => sum + (targetStatus === 'active' || targetStatus === undefined ? allocationWeight : 0), 0);
    if (activeTotal !== 100 && input.changes.some((item) => item.targetStatus === 'active')) throw new Error(`active Goal 投入占比合计必须为 100，当前为 ${activeTotal}`);
    const originals = new Map(await Promise.all(goals.map(async ({ file: item }) => [item, await app.vault.read(item)] as const)));
    try {
      for (const { change, file: item } of goals) await app.fileManager.processFrontMatter(item, (fm) => {
        if (change.allocationWeight !== undefined) fm.allocation_weight = change.allocationWeight;
        if (change.targetStatus) fm.status = change.targetStatus;
        fm.human_confirmed = true; fm.updated = today();
        const history = Array.isArray(fm.weight_history) ? fm.weight_history : [];
        history.push(`${today()} | ${fm.allocation_weight} | 看板确认`); fm.weight_history = history;
      });
    } catch (error) {
      for (const [item, content] of originals) await app.vault.modify(item, content);
      throw error;
    }
    return true;
  };
}

export function vaultUpdateGoalOperation(app: App): UpdateGoalOperation {
  return async (input) => {
    const target = await file(app, input.path);
    const cached = app.metadataCache.getFileCache(target)?.frontmatter;
    if (cached?.type !== 'goal') throw new Error('目标文件不是 Goal');
    if (cached?.status === 'active' && (input.expectedResults !== undefined || input.metrics !== undefined) && !input.humanConfirmed) throw new Error('修改 active Goal 结果定义需要人工确认');
    if (input.title !== undefined && !input.title.trim()) throw new Error('Goal 名称不能为空');
    const original = await app.vault.read(target);
    let evidenceToAppend: string[] = [];
    try {
      await app.fileManager.processFrontMatter(target, (fm) => {
        if (input.title !== undefined) fm.title = input.title.trim();
        if (input.health !== undefined) fm.health = input.health;
        const existingEvidence = Array.isArray(fm.result_evidence) ? fm.result_evidence.map(String) : [];
        evidenceToAppend = (input.appendEvidence ?? [])
          .map((value) => value.trim())
          .filter((value) => value.length > 0 && !existingEvidence.includes(value));
        if (evidenceToAppend.length) fm.result_evidence = [...existingEvidence, ...evidenceToAppend];
        fm.updated = today(); if (input.humanConfirmed) fm.human_confirmed = true;
      });
      let content = await app.vault.read(target);
      const replaceSection = (heading: string, values: string[] | undefined): void => {
        if (values === undefined) return;
        const block = `## ${heading}\n\n${values.length ? values.map((value) => `- ${value}`).join('\n') : '- '}`;
        const pattern = new RegExp(`^## ${heading}\\s*$[\\s\\S]*?(?=^## |$)`, 'm');
        content = pattern.test(content) ? content.replace(pattern, `${block}\n\n`) : `${content.trimEnd()}\n\n${block}\n`;
      };
      replaceSection('期望结果', input.expectedResults); replaceSection('量化指标', input.metrics); replaceSection('不做什么', input.notDoing); replaceSection('约束与代价', input.constraints);
      if (evidenceToAppend.length) {
        const additions = evidenceToAppend.map((value) => `- ${today()}：${value}`).join('\n');
        content = /^## 进展证据\s*$/m.test(content) ? content.replace(/^## 进展证据\s*$/m, (heading) => `${heading}\n\n${additions}`) : `${content.trimEnd()}\n\n## 进展证据\n\n${additions}\n`;
      }
      await app.vault.modify(target, content);
    } catch (error) {
      await app.vault.modify(target, original);
      throw error;
    }
    return true;
  };
}

async function updateTask(app: App, input: KosUpdateTaskInput): Promise<boolean> {
  const target = await file(app, input.path);
  await app.fileManager.processFrontMatter(target, (fm) => {
    if (input.title !== undefined) fm.title = input.title;
    if (input.projects !== undefined) fm.projects = [...new Set(input.projects)];
    if (input.priority !== undefined) fm.priority = input.priority;
    if (input.scheduledFor !== undefined) fm.scheduled_for = input.scheduledFor;
    if (input.deferUntil !== undefined) fm.defer_until = input.deferUntil;
    if (input.due !== undefined) fm.due = input.due;
    if (input.estimateMinutes !== undefined) fm.estimate_minutes = input.estimateMinutes;
    if (input.energy !== undefined) fm.energy = input.energy;
    if (input.workMode !== undefined) fm.work_mode = input.workMode;
    if (input.growthMode !== undefined) fm.growth_mode = input.growthMode;
    if (input.scheduledTimes !== undefined) fm.scheduled_times = input.scheduledTimes;
    delete fm.project;
  });
  return true;
}

export function vaultTaskOperations(app: App): TaskOperations {
  return {
    update: (input) => updateTask(app, input),
    defer: async (path, deferUntil, reason) => {
      const target = await file(app, path);
      await app.fileManager.processFrontMatter(target, (fm) => {
        if (fm.status !== 'todo') throw new Error('只有 todo Task 可以推迟');
        fm.defer_until = deferUntil; fm.scheduled_for = '';
        fm.recommendation_history = [...(Array.isArray(fm.recommendation_history) ? fm.recommendation_history : []), `${today()} | deferred:${deferUntil}${reason ? ` | ${reason}` : ''}`];
      }); return true;
    },
    returnToPool: async (path, reason) => {
      const target = await file(app, path);
      await app.fileManager.processFrontMatter(target, (fm) => {
        fm.scheduled_for = '';
        fm.recommendation_history = [...(Array.isArray(fm.recommendation_history) ? fm.recommendation_history : []), `${today()} | returned_to_pool${reason ? ` | ${reason}` : ''}`];
      }); return true;
    },
    block: (path, reason, unblockCondition) => vaultTransitionOperation(app)(path, 'blocked', false, reason, unblockCondition),
    complete: async (input: KosCompleteTaskInput) => {
      if (!input.result.trim()) throw new Error('完成 Task 必须填写实际结果');
      const target = await file(app, input.path);
      const cache = app.metadataCache.getFileCache(target)?.frontmatter;
      const projects = Array.isArray(cache?.projects) ? cache.projects.map(String) : [];
      if (projects.length !== input.contributions.length) throw new Error('必须为每个关联 Project 记录贡献判断');
      await app.fileManager.processFrontMatter(target, (fm) => {
        fm.status = 'done'; fm.completed = today(); fm.result = input.result.trim(); fm.outputs = input.outputs ?? [];
        fm.project_contributions = input.contributions.map((item) => `${item.project} | ${item.level} | ${item.evidence}`); fm.scheduled_for = '';
      });
      for (const contribution of input.contributions.filter((item) => item.level !== 'incidental')) {
        const projectPath = `${contribution.project.replace(/^\[\[/, '').replace(/\]\]$/, '').split('|')[0].replace(/\.md$/, '')}.md`;
        const project = app.vault.getAbstractFileByPath(projectPath);
        if (!(project instanceof TFile)) continue;
        const content = await app.vault.read(project);
        const evidence = `- ${today()}：${input.result.trim()}（Task [[${input.path.replace(/\.md$/, '')}]]；贡献 ${contribution.level}；${contribution.evidence}）`;
        const heading = /^## 进展证据\s*$/m.exec(content);
        await app.vault.modify(project, heading ? content.replace(/^## 进展证据\s*$/m, (value) => `${value}\n\n${evidence}`) : `${content.trimEnd()}\n\n## 进展证据\n\n${evidence}\n`);
      }
      return true;
    },
    archive: async (path: string) => {
      const target = await file(app, path);
      const fm = app.metadataCache.getFileCache(target)?.frontmatter;
      if (fm?.status !== 'done') throw new Error('只有已完成任务可以归档');
      if (!Array.isArray(fm.projects) || fm.projects.length === 0) throw new Error('只有关联 Project 的任务会进入归档提醒');
      const year = typeof fm.completed === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(fm.completed) ? fm.completed.slice(0, 4) : today().slice(0, 4);
      const directory = normalizePath(`32_任务/归档/${year}`);
      await ensureFolder(app, directory);
      const destination = normalizePath(`${directory}/${target.name}`);
      if (await app.vault.adapter.exists(destination)) throw new Error(`归档目标已存在：${destination}`);
      await app.fileManager.renameFile(target, destination);
      return true;
    },
  };
}

export function vaultUpdateProjectOperation(app: App): UpdateProjectOperation {
  return async (input: KosUpdateProjectInput) => {
    if (input.metrics !== undefined && input.metrics.length === 0) throw new Error('Project 至少需要一个量化指标');
    if (input.offGoalOverride && (!input.overrideReason?.trim() || !input.overrideReviewDue?.trim())) throw new Error('低支持度 Project 继续推进必须填写理由和复查日期');
    const target = await file(app, input.query);
    await app.fileManager.processFrontMatter(target, (fm) => {
      if (input.currentStage !== undefined) fm.current_stage = input.currentStage;
      if (input.nextMilestone !== undefined) fm.next_milestone = input.nextMilestone;
      if (input.due !== undefined) fm.due = input.due;
      if (input.goalAlignment !== undefined) fm.goal_alignment = input.goalAlignment;
      if (input.alignmentReviewed !== undefined) fm.alignment_reviewed = input.alignmentReviewed;
      if (input.metrics !== undefined) {
        fm.process_metrics = input.metrics.filter((metric) => metric.kind === 'process');
        fm.result_metrics = input.metrics.filter((metric) => metric.kind === 'result');
      }
      if (input.offGoalOverride !== undefined) fm.off_goal_override = input.offGoalOverride;
      if (input.overrideReason !== undefined) fm.override_reason = input.overrideReason;
      if (input.overrideReviewDue !== undefined) fm.override_review_due = input.overrideReviewDue;
      fm.updated = today();
    });
    return true;
  };
}
