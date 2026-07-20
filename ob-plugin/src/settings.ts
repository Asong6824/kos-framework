/**
 * settings.ts — 设置项与设置页（02 文档第 5 节）
 */

import { App, PluginSettingTab, Setting } from 'obsidian';
import { DEFAULT_OBJECT_DIRS, normalizeObjectDirs } from './core/model';
import type { ObjectDirs } from './core/model';
import type { MetricSettings } from './core/metrics';
import type KosCompanionPlugin from './main';

export interface KosSettings {
  /** 项目停滞预警天数（M10 stale 判定），默认 3 */
  staleThresholdDays: number;
  /** 热力图是否计入日记（M5），默认 true */
  heatmapIncludeDiary: boolean;
  /** 徽章解锁动画开关（M13），默认 true */
  enableBadges: boolean;
  /** 人工确认流转是否弹确认框（B3/B4），默认 true */
  reviewConfirmDialog: boolean;
  /** harness 桥接的 Python 路径（D1，仅桌面端），默认 python3 */
  pythonPath: string;
  /** 周起始日：0=周日 1=周一，默认 1 */
  weekStart: number;
  /** 目录映射（个性化布局）：各对象目录的 vault 相对路径，默认标准布局 */
  objectDirs: ObjectDirs;
}

export const DEFAULT_SETTINGS: KosSettings = {
  staleThresholdDays: 3,
  heatmapIncludeDiary: true,
  enableBadges: true,
  reviewConfirmDialog: true,
  pythonPath: 'python3',
  weekStart: 1,
  objectDirs: { ...DEFAULT_OBJECT_DIRS },
};

/** 目录映射设置项的展示文案（键对齐 ObjectDirs） */
const OBJECT_DIR_ITEMS: { key: keyof ObjectDirs; label: string; usage: string }[] = [
  { key: 'inbox', label: '收件箱', usage: '快速捕获（B1）落盘目录；inbox-zero 徽章（M13）统计口径' },
  { key: 'source', label: '原材料（source）', usage: '新建输入源落盘根目录，仍按 format 拼中文子目录' },
  { key: 'extract', label: '摘录（extract）', usage: '摘录目录（索引为 type-first，此项供落盘/展示用）' },
  { key: 'summary', label: '摘要（summary）', usage: '摘要目录（同上）' },
  { key: 'research', label: '研究（research）', usage: '研究目录（同上）' },
  { key: 'concept', label: '知识库（concept）', usage: '新建概念落盘目录' },
  { key: 'method', label: '方法库（method）', usage: '新建方法落盘目录' },
  { key: 'project', label: '项目（project）', usage: '新建项目落盘目录' },
  { key: 'task', label: '任务（task）', usage: '新建任务落盘目录' },
  { key: 'diary', label: '日记（diary）', usage: '日记落盘根目录，仍拼 YYYY/MM；周报/月报写入共用' },
  { key: 'reflection', label: '认知记录（reflection）', usage: '认知记录目录（索引为 type-first，此项供落盘/展示用）' },
  { key: 'radar', label: '信息雷达（signal）', usage: '信息雷达目录（同上）' },
];

/** 喂给 core metrics 的 settings 参数 */
export function toMetricSettings(s: KosSettings): MetricSettings {
  return {
    weekStart: s.weekStart,
    staleThresholdDays: s.staleThresholdDays,
    heatmapIncludeDiary: s.heatmapIncludeDiary,
  };
}

export class KosSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: KosCompanionPlugin,
  ) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName('项目停滞预警天数')
      .setDesc('active 项目的 updated 距今达到该天数时标记停滞（M10），默认 3 天。')
      .addText((text) =>
        text
          .setPlaceholder(String(DEFAULT_SETTINGS.staleThresholdDays))
          .setValue(String(this.plugin.settings.staleThresholdDays))
          .onChange(async (value) => {
            const n = Number(value);
            if (Number.isInteger(n) && n >= 1) {
              this.plugin.settings.staleThresholdDays = n;
              await this.plugin.saveSettings();
            }
          }),
      );

    new Setting(containerEl)
      .setName('热力图计入日记')
      .setDesc('关闭后，M5 活动热力图与 M6 streak 不再把"当天有日记"计入活跃度。')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.heatmapIncludeDiary).onChange(async (value) => {
          this.plugin.settings.heatmapIncludeDiary = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName('徽章解锁动画')
      .setDesc('达成徽章条件（M13）时是否展示解锁动画。')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.enableBadges).onChange(async (value) => {
          this.plugin.settings.enableBadges = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName('流转确认对话框')
      .setDesc('规范要求人确认的状态流转（B3/B4）执行前是否弹确认框。')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.reviewConfirmDialog).onChange(async (value) => {
          this.plugin.settings.reviewConfirmDialog = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName('Python 路径')
      .setDesc('D1 harness 桥接使用的 Python 解释器路径（仅桌面端），默认 python3。')
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SETTINGS.pythonPath)
          .setValue(this.plugin.settings.pythonPath)
          .onChange(async (value) => {
            const v = value.trim();
            if (v.length > 0) {
              this.plugin.settings.pythonPath = v;
              await this.plugin.saveSettings();
            }
          }),
      );

    new Setting(containerEl)
      .setName('周起始日')
      .setDesc('本周统计与周报/月报（M2/M14）的周起始日。')
      .addDropdown((dropdown) =>
        dropdown
          .addOption('1', '周一')
          .addOption('0', '周日')
          .setValue(String(this.plugin.settings.weekStart))
          .onChange(async (value) => {
            this.plugin.settings.weekStart = Number(value);
            await this.plugin.saveSettings();
          }),
      );

    // 目录映射（个性化布局）：索引为 type-first，以下目录只影响落盘位置与收件箱识别
    containerEl.createEl('h3', { text: '目录映射（个性化布局）' });
    containerEl.createEl('p', {
      text: '索引按 frontmatter 的 type 字段归类，与目录无关；此处仅配置快速捕获/创建向导/日记的落盘目录与收件箱位置。'
        + '填写 vault 相对路径（不带首尾斜杠），留空回落标准默认值。',
      cls: 'setting-item-description',
    });
    for (const item of OBJECT_DIR_ITEMS) {
      new Setting(containerEl)
        .setName(item.label)
        .setDesc(`${item.usage}。标准默认：${DEFAULT_OBJECT_DIRS[item.key]}`)
        .addText((text) =>
          text
            .setPlaceholder(DEFAULT_OBJECT_DIRS[item.key])
            .setValue(this.plugin.settings.objectDirs[item.key])
            .onChange(async (value) => {
              // 留空回落默认；非法字符只做 trim（含首尾斜杠归一，见 normalizeObjectDirs）
              const merged = normalizeObjectDirs({ [item.key]: value });
              this.plugin.settings.objectDirs[item.key] = merged[item.key];
              if (value.trim() === '') text.setValue(merged[item.key]);
              await this.plugin.saveSettings();
            }),
        );
    }
  }
}
