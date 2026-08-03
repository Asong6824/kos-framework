/**
 * settings.ts — 设置项与设置页（02 文档第 5 节）
 */

import { App, Modal, Notice, PluginSettingTab, Setting } from 'obsidian';
import { DEFAULT_OBJECT_DIRS, normalizeObjectDirs } from './core/model';
import type { ObjectDirs } from './core/model';
import type KosCompanionPlugin from './main';
import { createKosSyncJoinCode, parseKosSyncJoinCode } from './sync/pairing';
import { DEFAULT_SETTINGS, toMetricSettings } from './settings-model';
import type { KosSettings } from './settings-model';

export { DEFAULT_SETTINGS, toMetricSettings };
export type { KosSettings };

/** 目录映射设置项的展示文案（键对齐 ObjectDirs） */
const OBJECT_DIR_ITEMS: { key: keyof ObjectDirs; label: string; usage: string }[] = [
  { key: 'inbox', label: '收件箱', usage: '快速捕获（B1）落盘目录；inbox-zero 徽章（M13）统计口径' },
  { key: 'source', label: '原材料（source）', usage: '新建输入源落盘根目录，仍按 format 拼中文子目录' },
  { key: 'extract', label: '摘录（extract）', usage: '摘录目录（索引为 type-first，此项供落盘/展示用）' },
  { key: 'summary', label: '摘要（summary）', usage: '摘要目录（同上）' },
  { key: 'research', label: '研究（research）', usage: '研究目录（同上）' },
  { key: 'concept', label: '知识库（concept）', usage: '新建概念落盘目录' },
  { key: 'method', label: '方法库（method）', usage: '新建方法落盘目录' },
  { key: 'goal', label: '半年目标（goal）', usage: 'H1/H2 Goal 落盘根目录，创建时按 YYYY-H1/H2 分期' },
  { key: 'project', label: '项目（project）', usage: '新建项目落盘目录' },
  { key: 'task', label: '任务（task）', usage: '新建任务落盘目录' },
  { key: 'diary', label: '日记（diary）', usage: '日记落盘根目录，仍拼 YYYY/MM；周报/月报写入共用' },
  { key: 'reflection', label: '认知记录（reflection）', usage: '认知记录目录（索引为 type-first，此项供落盘/展示用）' },
  { key: 'radar', label: '信息雷达（signal）', usage: '信息雷达目录（同上）' },
];

/** 喂给 core metrics 的 settings 参数 */
class KosSyncJoinModal extends Modal {
  constructor(
    app: App,
    private readonly initialValue: string,
    private readonly submit: (code: string) => Promise<void>,
  ) {
    super(app);
  }

  onOpen(): void {
    this.contentEl.empty();
    this.contentEl.createEl('h2', { text: '加入 kos-sync Vault' });
    this.contentEl.createEl('p', {
      text: '粘贴桌面端生成的加入码。加入码包含未加密的 R2 凭据，导入后请清空剪贴板。',
    });
    const input = this.contentEl.createEl('textarea', {
      attr: {
        rows: '6',
        placeholder: 'KOS-SYNC1.…',
        'aria-label': 'kos-sync 设备加入码',
      },
    });
    input.value = this.initialValue;
    input.style.width = '100%';
    const length = this.contentEl.createEl('p', { cls: 'setting-item-description' });
    const refreshLength = () => {
      const count = input.value.trim().length;
      length.setText(count > 0
        ? `已粘贴 ${count} 个字符。不要从聊天气泡分段选择；请整行复制。`
        : '尚未粘贴加入码。加入码必须以 KOS-SYNC1. 开头。');
    };
    input.addEventListener('input', refreshLength);
    refreshLength();
    const actions = this.contentEl.createDiv({ cls: 'modal-button-container' });
    const join = actions.createEl('button', { cls: 'mod-cta', text: '加入并开始同步' });
    join.addEventListener('click', () => {
      void this.submit(input.value)
        .then(() => this.close())
        .catch((error: unknown) => {
          new Notice(error instanceof Error ? error.message : String(error));
        });
    });
    input.focus();
  }
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
      .setName('首次使用向导')
      .setDesc('重新检查模型、系统结构、最小工作对象和多端同步的准备状态。')
      .addButton((button) => button.setButtonText('打开向导').onClick(() => void this.plugin.openOnboarding()));

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

    containerEl.createEl('h3', { text: '多端同步' });
    containerEl.createEl('p', {
      text: 'kos-sync 使用私人 Cloudflare R2 自动同步 Vault。同步内容不做端到端加密；任何拥有 Bucket 读取权限的人都能读取内容。'
        + '同一个 Vault 不得同时使用 iCloud、Obsidian Sync、Syncthing 或其他双向同步。',
      cls: 'setting-item-description',
    });
    containerEl.createEl('p', {
      text: '第一台设备：填写下面四项后再打开同步。第二台设备：不要逐项填写，直接使用“从剪贴板加入”。'
        + '源端显示“已同步”后才能复制加入码。',
      cls: 'setting-item-description',
    });
    new Setting(containerEl)
      .setName('Cloudflare Account ID')
      .setDesc('Cloudflare 控制台中的 32 位 Account ID。')
      .addText((text) => text.setValue(this.plugin.settings.sync.accountId).onChange(async (value) => {
        this.plugin.settings.sync.accountId = value.trim();
        await this.plugin.saveSettings();
      }));
    new Setting(containerEl)
      .setName('R2 Bucket')
      .setDesc('私有 Bucket 名称；不要把 Bucket 设为公开。')
      .addText((text) => text.setValue(this.plugin.settings.sync.bucket).onChange(async (value) => {
        this.plugin.settings.sync.bucket = value.trim();
        await this.plugin.saveSettings();
      }));
    new Setting(containerEl)
      .setName('R2 Access Key ID')
      .setDesc('只授予指定 Bucket Object Read & Write 权限。')
      .addText((text) => text.setValue(this.plugin.settings.sync.accessKeyId).onChange(async (value) => {
        this.plugin.settings.sync.accessKeyId = value.trim();
        await this.plugin.saveSettings();
      }));
    new Setting(containerEl)
      .setName('R2 Secret Access Key')
      .setDesc('只保存在本设备的插件私有 data.json，不写入 Vault 内容或日志。')
      .addText((text) => {
        text.inputEl.type = 'password';
        text.setValue(this.plugin.settings.sync.secretAccessKey).onChange(async (value) => {
          this.plugin.settings.sync.secretAccessKey = value.trim();
          await this.plugin.saveSettings();
        });
      });
    new Setting(containerEl)
      .setName('测试 R2 读写')
      .setDesc('在当前 Vault 的隔离前缀写入、读回并删除一个随机测试对象；不会修改 Journal 或清空远端数据。测试通过后才能首次启用同步。')
      .addButton((button) => button.setButtonText('开始测试').onClick(async () => {
        button.setDisabled(true).setButtonText('测试中…');
        try {
          const { result } = await this.plugin.testSyncConfiguration();
          new Notice(`R2 读写测试通过 · ${result.latencyMs} ms${result.remoteHasData ? ' · 远端已有同步数据' : ' · 当前同步空间为空'}`);
        } catch (error) {
          new Notice(error instanceof Error ? error.message : String(error));
        } finally {
          button.setDisabled(false).setButtonText('开始测试');
        }
      }));
    new Setting(containerEl)
      .setName('添加另一台设备')
      .setDesc('加入码包含 R2 凭据。只通过可信的设备间剪贴板临时传递；粘贴后可立即清空剪贴板。')
      .addButton((button) => button
        .setButtonText('复制本机加入码')
        .onClick(async () => {
          try {
            const code = createKosSyncJoinCode(this.plugin.settings.sync);
            await navigator.clipboard.writeText(code);
            new Notice('kos-sync 加入码已复制；请在另一台设备粘贴后清空剪贴板');
          } catch (error) {
            new Notice(error instanceof Error ? error.message : String(error));
          }
        }))
      .addButton((button) => button
        .setButtonText('从剪贴板加入')
        .onClick(async () => {
          let clipboard = '';
          try {
            clipboard = await navigator.clipboard.readText();
            await this.applySyncJoinCode(clipboard);
          } catch {
            new KosSyncJoinModal(
              this.app,
              clipboard,
              async (code) => this.applySyncJoinCode(code),
            ).open();
          }
        }));
    new Setting(containerEl)
      .setName('多端同步')
      .setDesc('启用后使用固定的启动、保存、打开文件和周期同步策略。')
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.sync.enabled).onChange(async (value) => {
        if (value && !(await this.plugin.hasCurrentSyncPreflight())) {
          toggle.setValue(false);
          new Notice('首次启用前请先完成“测试 R2 读写”；配置变化后需要重新测试');
          return;
        }
        this.plugin.settings.sync.enabled = value;
        await this.plugin.saveSettings();
        const snapshot = await this.plugin.reloadSync();
        if (snapshot.phase === 'error' || snapshot.phase === 'offline') {
          new Notice(`同步尚未就绪：${snapshot.message}`);
        }
      }))
      .addButton((button) => button
        .setButtonText('应用并重新连接')
        .setDisabled(!this.plugin.settings.sync.enabled)
        .onClick(async () => {
          try {
            await this.plugin.testSyncConfiguration();
          } catch (error) {
            new Notice(error instanceof Error ? error.message : String(error));
            return;
          }
          const snapshot = await this.plugin.reloadSync();
          new Notice(snapshot.phase === 'up-to-date'
            ? 'kos-sync 已连接并完成同步'
            : `kos-sync 尚未就绪：${snapshot.message}`);
        }));

    containerEl.createEl('h3', { text: 'kos Agent' });
    new Setting(containerEl)
      .setName('Agent host 路径')
      .setDesc('kos-agent 可执行文件或 rpc-entry.mjs 的绝对路径。留空时优先使用插件内置 host。')
      .addText((text) =>
        text
          .setPlaceholder('自动发现')
          .setValue(this.plugin.settings.agentHostPath)
          .onChange(async (value) => {
            this.plugin.settings.agentHostPath = value.trim();
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Node 路径')
      .setDesc('可选。自动发现失败时，填写 Node.js 22.19+ 可执行文件的绝对路径。')
      .addText((text) =>
        text
          .setPlaceholder('自动发现 Node.js 22.19+')
          .setValue(this.plugin.settings.agentNodePath)
          .onChange(async (value) => {
            this.plugin.settings.agentNodePath = value.trim();
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('自动启动 Agent')
      .setDesc('打开 kos Agent 侧栏时启动子进程并续接该 vault 的最近会话。')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.agentAutoStart).onChange(async (value) => {
          this.plugin.settings.agentAutoStart = value;
          await this.plugin.saveSettings();
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

  private async applySyncJoinCode(code: string): Promise<void> {
    const candidate = parseKosSyncJoinCode(code);
    await this.plugin.testSyncConfiguration(candidate, true);
    const snapshot = await this.plugin.reloadSync();
    new Notice(snapshot.phase === 'up-to-date' || snapshot.phase === 'conflict'
      ? '已加入同一个 kos-sync Vault；请清空剪贴板'
      : `加入码已保存，但首次同步尚未完成：${snapshot.message}`);
    this.display();
  }
}
