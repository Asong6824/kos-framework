/**
 * create.ts — B5 创建向导（等价 harness create_*.py）
 *
 * 模板：优先读 vault `90_系统/模板/` 对应文件（存在即用，模板更新自动生效），
 * 读不到用内置兜底模板并 Notice 提示。落盘根目录来自 settings.objectDirs
 * （默认对齐对象规范标准布局），命名规则不变；
 * 已存在同名文件时报错不覆盖（写入边界见 02 文档 3.4 节）。
 */

import { App, Modal, Notice, Setting, TFile } from 'obsidian';
import { SOURCE_FORMATS } from '../core/model';
import type { ObjectDirs, SourceFormat } from '../core/model';
import { localToday } from '../data/store';
import { sanitizeFileName } from './capture';

/** 模板目录（vault 内相对路径） */
export const TEMPLATE_DIR = '90_系统/模板';

export type CreateKind = 'project' | 'concept' | 'method' | 'task' | 'source';

/** 弹窗收集的额外字段（project 的 goal/priority、source 的 format） */
export interface CreateExtra {
  goal?: string;
  priority?: string;
  format?: SourceFormat;
}

interface CreateSpec {
  label: string;
  /** 模板文件名（TEMPLATE_DIR 下） */
  templateFile: string;
  /** 模板里的标题占位串（frontmatter title 与正文 # 标题共用） */
  titlePlaceholder: string;
  /** 落盘路径（不含已存在检查）；根目录来自 settings.objectDirs */
  buildPath: (title: string, extra: CreateExtra, dirs: ObjectDirs) => string;
  /** 内置兜底模板 */
  fallback: (title: string, today: string, extra: CreateExtra) => string;
}

/** source format → 原材料子目录（对齐 vault 现有中文目录；根目录由 objectDirs.source 配置） */
const FORMAT_DIRS: Record<SourceFormat, string> = {
  book: '书籍',
  paper: '论文',
  article: '文章',
  video: '视频',
  audio: '音频',
  podcast: '播客',
  report: '研报',
  news: '新闻',
  x_post: '帖子',
  course: '课程',
};

const CREATE_SPECS: Record<CreateKind, CreateSpec> = {
  project: {
    label: '项目',
    templateFile: 'Project_项目模板.md',
    titlePlaceholder: '项目名',
    buildPath: (t, _extra, dirs) => `${dirs.project}/${t}.md`,
    fallback: (t, today, extra) => `---
type: project
title: "${t}"
status: idea
category: other
priority: ${extra.priority ?? 'P2'}
area: ""
goal: "${extra.goal ?? ''}"
current_stage: ""
due: ""
created: ${today}
updated: ${today}
related_sources: []
related_research: []
related_concepts: []
related_methods: []
tags: []
---
# ${t}

## 背景

## 决策日志

## 进展

## 当前任务

- [ ] 

## 相关
`,
  },
  concept: {
    label: '概念',
    templateFile: 'Concept_原子概念模板.md',
    titlePlaceholder: '概念名',
    buildPath: (t, _extra, dirs) => `${dirs.concept}/${t}.md`,
    fallback: (t, today) => `---
type: concept
title: "${t}"
status: draft
confidence: draft
area: ""
created: ${today}
updated: ${today}
aliases: []
source: ""
related_sources: []
related_research: []
related_projects: []
related_concepts: []
tags: []
---
# ${t}

## 定义

## 我的理解

## 相关概念

- 
`,
  },
  method: {
    label: '方法',
    templateFile: 'Method_方法模板.md',
    titlePlaceholder: '方法名',
    buildPath: (t, _extra, dirs) => `${dirs.method}/${t}.md`,
    fallback: (t, today) => `---
type: method
title: "${t}"
status: candidate
created: ${today}
updated: ${today}
applicable_scenarios: []
validated_times: 0
related_projects: []
related_concepts: []
tags: []
---
# ${t}

## 适用场景

## 执行步骤

1. 

## 使用记录

- ${today}：
`,
  },
  task: {
    label: '任务',
    templateFile: 'Task_任务模板.md',
    titlePlaceholder: '任务名',
    buildPath: (t, _extra, dirs) => `${dirs.task}/${t}.md`,
    fallback: (t, today) => `---
type: task
title: "${t}"
status: todo
project: ""
priority: P2
due: ""
created: ${today}
completed: ""
tags: []
---
# 任务：${t}

## 描述

## 下一步行动

- [ ] 
`,
  },
  source: {
    label: '输入源',
    templateFile: 'Source_输入源模板.md',
    titlePlaceholder: '标题',
    buildPath: (t, extra, dirs) => `${dirs.source}/${FORMAT_DIRS[extra.format ?? 'article']}/${t}.md`,
    fallback: (t, today, extra) => `---
type: source
format: ${extra.format ?? 'article'}
title: "${t}"
author: ""
source_url: ""
created: ${today}
status: captured
importance: medium
summary_file: ""
extract_file: ""
tags: []
---
# ${t}

## 原始内容或来源说明

## 待处理

- [ ] 是否需要摘录
- [ ] 是否需要摘要
`,
  },
};

/** YAML 双引号串内的安全文本（" 与反斜杠转义） */
function yamlText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** 逐级创建目录（已存在则跳过）；capture.ts 写收件箱前也复用 */
export async function ensureFolder(app: App, dir: string): Promise<void> {
  let cur = '';
  for (const part of dir.split('/')) {
    cur = cur === '' ? part : `${cur}/${part}`;
    if (!(await app.vault.adapter.exists(cur))) {
      await app.vault.createFolder(cur);
    }
  }
}

/** 读模板文件；读不到返回 null（调用方用兜底模板） */
async function readTemplate(app: App, file: string): Promise<string | null> {
  const path = `${TEMPLATE_DIR}/${file}`;
  try {
    if (!(await app.vault.adapter.exists(path))) return null;
    return await app.vault.adapter.read(path);
  } catch {
    return null;
  }
}

/** 模板占位替换：YYYY-MM-DD → 今天；标题占位 → 实际标题；额外字段按类型替换 */
function renderTemplate(spec: CreateSpec, template: string, title: string, today: string, extra: CreateExtra): string {
  let out = template.split('YYYY-MM-DD').join(today);
  out = out.split(spec.titlePlaceholder).join(title);
  if (extra.goal !== undefined && extra.goal !== '') {
    out = out.replace('goal: ""', `goal: "${yamlText(extra.goal)}"`);
  }
  if (extra.priority !== undefined) {
    out = out.replace('priority: P2', `priority: ${extra.priority}`);
  }
  if (extra.format !== undefined) {
    out = out.replace('format: article', `format: ${extra.format}`);
  }
  return out;
}

/** 创建 kos 对象文件：模板渲染 + 落盘；已存在报错不覆盖。返回创建的文件 */
export async function createKosFile(
  app: App,
  kind: CreateKind,
  title: string,
  dirs: ObjectDirs,
  extra: CreateExtra = {},
): Promise<TFile | null> {
  const spec = CREATE_SPECS[kind];
  const name = sanitizeFileName(title);
  if (name === '') {
    new Notice('标题为空或全是非法字符');
    return null;
  }
  const path = spec.buildPath(name, extra, dirs);
  if (await app.vault.adapter.exists(path)) {
    new Notice(`已存在同名文件，未覆盖：${path}`);
    return null;
  }
  const today = localToday();
  const template = await readTemplate(app, spec.templateFile);
  if (template === null) {
    new Notice(`模板缺失（${spec.templateFile}），已使用内置兜底模板`);
  }
  const content =
    template !== null ? renderTemplate(spec, template, name, today, extra) : spec.fallback(name, today, extra);
  const dir = path.slice(0, path.lastIndexOf('/'));
  await ensureFolder(app, dir);
  const file = await app.vault.create(path, content);
  new Notice(`已创建${spec.label}：${path}`);
  return file;
}

/** 创建向导 Modal：标题 + （project 的 goal/priority | source 的 format） */
class CreateModal extends Modal {
  private title = '';
  private goal = '';
  private priority = 'P2';
  private format: SourceFormat = 'article';

  constructor(
    app: App,
    private readonly kind: CreateKind,
    private readonly dirs: ObjectDirs,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    const spec = CREATE_SPECS[this.kind];
    contentEl.addClass('kos-modal');
    contentEl.createEl('h3', { text: `新建${spec.label}` });

    new Setting(contentEl).setName('标题').addText((text) => {
      text.setPlaceholder(`${spec.label}标题`).onChange((v) => (this.title = v));
      text.inputEl.focus();
    });

    if (this.kind === 'project') {
      new Setting(contentEl).setName('目标（goal）').addText((text) =>
        text.setPlaceholder('可选').onChange((v) => (this.goal = v)),
      );
      new Setting(contentEl).setName('优先级').addDropdown((dropdown) =>
        dropdown
          .addOptions({ P0: 'P0', P1: 'P1', P2: 'P2', P3: 'P3', P4: 'P4' })
          .setValue(this.priority)
          .onChange((v) => (this.priority = v)),
      );
    }
    if (this.kind === 'source') {
      new Setting(contentEl).setName('格式').addDropdown((dropdown) => {
        for (const f of SOURCE_FORMATS) dropdown.addOption(f, `${f}（${FORMAT_DIRS[f]}）`);
        dropdown.setValue(this.format).onChange((v) => (this.format = v as SourceFormat));
      });
    }

    const row = contentEl.createDiv({ cls: 'kos-modal-buttons' });
    const ok = row.createEl('button', { cls: 'mod-cta', text: '创建' });
    ok.addEventListener('click', () => {
      const extra: CreateExtra = {};
      if (this.kind === 'project') {
        extra.goal = this.goal;
        extra.priority = this.priority;
      }
      if (this.kind === 'source') extra.format = this.format;
      void createKosFile(this.app, this.kind, this.title, this.dirs, extra).then((file) => {
        if (file) {
          this.close();
          void this.app.workspace.getLeaf('tab').openFile(file);
        }
      });
    });
    const cancel = row.createEl('button', { text: '取消' });
    cancel.addEventListener('click', () => this.close());
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/** B5 入口：打开创建向导 */
export function openCreateModal(app: App, kind: CreateKind, dirs: ObjectDirs): void {
  new CreateModal(app, kind, dirs).open();
}

// ---------------------------------------------------------------------------
// 日记（create-diary / 报告写入共用）
// ---------------------------------------------------------------------------

const WEEKDAY_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** ISO 8601 周数（对齐 harness generate_diary.py 的 %V） */
export function isoWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = (d.getUTCDay() + 6) % 7; // 周一 = 0
  d.setUTCDate(d.getUTCDate() - day + 3); // 本周周四（ISO 周归属日）
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const firstDay = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDay + 3);
  return 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 86400000));
}

/** 日记落盘路径：{objectDirs.diary}/YYYY/MM/YYYY-MM-DD.md */
export function diaryPath(date: string, dirs: ObjectDirs): string {
  return `${dirs.diary}/${date.slice(0, 4)}/${date.slice(5, 7)}/${date}.md`;
}

/** 日记兜底模板（对象规范正文结构） */
function diaryFallback(date: string): string {
  const d = new Date(`${date}T12:00:00`); // 取中午避免时区跨日
  return `---
type: diary
created: ${date}
date: ${date}
day_of_week: "${WEEKDAY_EN[d.getDay()]}"
week_number: ${isoWeekNumber(d)}
mood: ""
energy: 3
tags: [daily]
---
# ${date}

## 今日主线

## 今天推进了什么

- 

## 今天学习了什么

- 

## 今天产生的重要想法

- 

## 判断变化

- 

## 遇到的问题

- 

## 明天继续

- 
`;
}

/** 渲染日记模板：日期占位 + day_of_week + week_number */
function renderDiaryTemplate(template: string, date: string): string {
  const d = new Date(`${date}T12:00:00`);
  let out = template.split('YYYY-MM-DD').join(date);
  out = out.replace('day_of_week: ""', `day_of_week: "${WEEKDAY_EN[d.getDay()]}"`);
  out = out.replace('week_number: 1', `week_number: ${isoWeekNumber(d)}`);
  return out;
}

/**
 * 确保某日日记存在：已存在直接返回；不存在按模板创建（report.ts 写入章节前也用）。
 * 已存在时不做任何修改。
 */
export async function ensureDiary(app: App, date: string, dirs: ObjectDirs): Promise<TFile> {
  const path = diaryPath(date, dirs);
  const existing = app.vault.getAbstractFileByPath(path);
  if (existing instanceof TFile) return existing;

  const template = await readTemplate(app, 'Diary_日记模板.md');
  const content = template !== null ? renderDiaryTemplate(template, date) : diaryFallback(date);
  if (template === null) new Notice('模板缺失（Diary_日记模板.md），已使用内置兜底模板');
  await ensureFolder(app, path.slice(0, path.lastIndexOf('/')));
  return app.vault.create(path, content);
}

/** create-diary 命令：创建今日日记并打开 */
export async function createTodayDiary(app: App, dirs: ObjectDirs): Promise<void> {
  const today = localToday();
  const existed = app.vault.getAbstractFileByPath(diaryPath(today, dirs)) instanceof TFile;
  const file = await ensureDiary(app, today, dirs);
  new Notice(existed ? '今日日记已存在，直接打开' : `已创建今日日记：${file.path}`);
  await app.workspace.getLeaf('tab').openFile(file);
}
