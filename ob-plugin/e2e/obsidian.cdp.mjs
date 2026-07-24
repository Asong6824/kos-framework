import { mkdtemp, mkdir, cp, writeFile, readFile, access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(pluginRoot, '..');
const obsidianBin = '/Applications/Obsidian.app/Contents/MacOS/Obsidian';
const port = Number(process.env.KOS_OBSIDIAN_CDP_PORT || 9237);
const root = await mkdtemp(join(tmpdir(), 'kos-obsidian-e2e-'));
const vault = join(root, 'vault');
const profile = join(root, 'profile');
const artifacts = process.env.KOS_E2E_ARTIFACT_DIR || join(root, 'artifacts');
const pluginDir = join(vault, '.obsidian', 'plugins', 'kos-companion');
const agentEntry = join(repoRoot, 'agent', 'packages', 'kos-agent', 'dist', 'rpc-entry.js');
const goalPeriod = `${new Date().getFullYear()}-${new Date().getMonth() < 6 ? 'H1' : 'H2'}`;
const goalPath = join(vault, '30_目标', goalPeriod, '交付插件.md');
const projectDir = join(vault, '31_项目', '插件二期');
const projectPath = join(projectDir, '插件二期.md');
const taskPath = join(vault, '32_任务', 'E2E推进插件二期.md');
const readerExtractPath = join(vault, '20_处理区', '摘录', 'E2E 输入 01_摘录.md');
const readerPdfExtractPath = join(vault, '20_处理区', '摘录', 'E2E 输入 02_摘录.md');
const longSourceTitle = '从头展示的超长材料标题用于验证字符限制和悬停完整名称';
const pdfFixture = 'JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUiA0IDAgUl0gL0NvdW50IDIgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA2MTIgNzkyXSAvUmVzb3VyY2VzIDw8IC9Gb250IDw8IC9GMSA3IDAgUiA+PiA+PiAvQ29udGVudHMgNSAwIFIgPj4KZW5kb2JqCjQgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA2MTIgNzkyXSAvUmVzb3VyY2VzIDw8IC9Gb250IDw8IC9GMSA3IDAgUiA+PiA+PiAvQ29udGVudHMgNiAwIFIgPj4KZW5kb2JqCjUgMCBvYmoKPDwgL0xlbmd0aCA1NiA+PgpzdHJlYW0KQlQgL0YxIDI0IFRmIDcyIDcwMCBUZCAoS09TIFJlYWRlciBQREYgRTJFIFBhZ2UgMSkgVGogRVQKZW5kc3RyZWFtCmVuZG9iago2IDAgb2JqCjw8IC9MZW5ndGggNTYgPj4Kc3RyZWFtCkJUIC9GMSAyNCBUZiA3MiA3MDAgVGQgKEtPUyBSZWFkZXIgUERGIEUyRSBQYWdlIDIpIFRqIEVUCmVuZHN0cmVhbQplbmRvYmoKNyAwIG9iago8PCAvVHlwZSAvRm9udCAvU3VidHlwZSAvVHlwZTEgL0Jhc2VGb250IC9IZWx2ZXRpY2EgPj4KZW5kb2JqCnhyZWYKMCA4CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAwOSAwMDAwMCBuIAowMDAwMDAwMDU4IDAwMDAwIG4gCjAwMDAwMDAxMjEgMDAwMDAgbiAKMDAwMDAwMDI0NyAwMDAwMCBuIAowMDAwMDAwMzczIDAwMDAwIG4gCjAwMDAwMDA0NzkgMDAwMDAgbiAKMDAwMDAwMDU4NSAwMDAwMCBuIAp0cmFpbGVyCjw8IC9TaXplIDggL1Jvb3QgMSAwIFIgPj4Kc3RhcnR4cmVmCjY1NQolJUVPRgo=';
const epubFixture = 'UEsDBAoAAAAAAC9H9VxvYassFAAAABQAAAAIAAAAbWltZXR5cGVhcHBsaWNhdGlvbi9lcHViK3ppcFBLAwQKAAAAAAAvR/VcAAAAAAAAAAAAAAAACQAAAE1FVEEtSU5GL1BLAwQKAAAACAAvR/VcHgvXyZkAAADdAAAAFgAAAE1FVEEtSU5GL2NvbnRhaW5lci54bWxVjsEOwiAQRH+l4Wpa9EoAExPPmvgFK90qEXYJUKN/L3qoeptk5s2M3j5i6O6Yi2cyYjOsxdZqx1TBE+Z/p2tZKkbMmRRD8UURRCyqOsUJaWQ3R6SqPjG1lAirM3OdfMDyld00h9AnqFcjDvvd8STfQMMHTpPoIo4e+vpMaASkFLyD2o5IxnMqDXM3uOCqLQlptfzpl8uufQFQSwMECgAAAAAAL0f1XAAAAAAAAAAAAAAAAAYAAABPRUJQUy9QSwMECgAAAAgAL0f1XIfZ+p9aAQAArQIAABEAAABPRUJQUy9jb250ZW50Lm9wZpWSy0rEMBSGXyVkK23aCI6UtgPKuBFUcGbjLianbZg2iU06F5/eNJ2rK4VAwjn//50Lyee7rkUb6K3UqsBpnGAEimshVV3g1fIpusfzMjeMr1kNZ+HtKPRWZQvcOGcyQrbbbSyFqWLd14QmyYxoU2E0KPk1QCQFKCcrCX2BP7Ve+wAu8w4cE8yxCZUJfqKZoW8DSXACLXTebUkap8S7BM/OOCTFBXGtbQQUcnKlCRYnXQvl8+s7WtAFWrytHoJqCo+Clql68FOW3030+BKSp1DoFJleG+jdvsCCO+g7m3V+U76Cr0wTehcls4imyyTJwvnIyWgrp2uc03OYkhVYV+bSQReaV2yDUdNDFZ7xrnFdi1EHQrLI7Q0UmBnTSs6cXz0J6ZvdKDm0I8FOEHIB5emRyRtmfLPp38FXHPqLQ//FIed5rZEKJrLnefhETY/lLoM0eA8Ocvh95Q9QSwMECgAAAAgAL0f1XDXoLbfYAAAAMwEAAA8AAABPRUJQUy9uYXYueGh0bWxtzjFuwjAUxvGrRG9vXgIDTfRstp4ADmASQyyltpUYkmwcgJWJhb2oc1Wpt2mVa9RuOhSpiyXbP+n/0bJ/rqODbFplNIM0TiCSujCl0jsG69XTwyMsOVXOKy91y6ByzuaIXdfF3Tw2zQ7TLMuwDwY8laLk5JSrJR8vr18fZ8LpRjj9bUw5cNLiEEm73+RusJKBMwVMhTy83mVUabc/oVmSLNDY1mdMzalWnERUNXLLoKiEdbJJ498d4+32+XYcX66EwpcD/YfP/vL30x3HkEA/05/TZAyWfwNQSwMECgAAAAgAL0f1XJ4D+uasAAAAzgAAABQAAABPRUJQUy9jaGFwdGVyMS54aHRtbLOxr8jNUShLLSrOzM+zVTLUM1BSSM1Lzk/JzEu3VQoNcdO1ULK3s8koAaoCqswrtlXKKCkpsNLXLy8v1ys31ssvStc3tLS01K8AqVECKk1NTLGzKcksyUm1e75mzZMdDc9XL7DRhwjY6EOkk/JTKoFKDZFVAHk2BXbe/sEKQUA1qUUKrgGhTgrPV69/2rEBSD7b2v1i/VSI+pcLtz5uaLLRLwAaCDFKH2S7HQBQSwMECgAAAAgAL0f1XA8iN0KsAAAAzgAAABQAAABPRUJQUy9jaGFwdGVyMi54aHRtbLOxr8jNUShLLSrOzM+zVTLUM1BSSM1Lzk/JzEu3VQoNcdO1ULK3s8koAaoCqswrtlXKKCkpsNLXLy8v1ys31ssvStc3tLS01K8AqVECKk1NTLGzKcksyUm1e75mzZNdPc9XL7DRhwjY6EOkk/JTKoFKDZFVAHk2BXbe/sEKQUA1qUUKrgGhTgrPV69/2rEBSD7b2v1i/VSI+pcLtz5uaLLRLwAaCDFKH2S7HQBQSwECFAAKAAAAAAAvR/Vcb2GrLBQAAAAUAAAACAAAAAAAAAAAAAAAAAAAAAAAbWltZXR5cGVQSwECFAAKAAAAAAAvR/VcAAAAAAAAAAAAAAAACQAAAAAAAAAAABAAAAA6AAAATUVUQS1JTkYvUEsBAhQACgAAAAgAL0f1XB4L18mZAAAA3QAAABYAAAAAAAAAAAAAAAAAYQAAAE1FVEEtSU5GL2NvbnRhaW5lci54bWxQSwECFAAKAAAAAAAvR/VcAAAAAAAAAAAAAAAABgAAAAAAAAAAABAAAAAuAQAAT0VCUFMvUEsBAhQACgAAAAgAL0f1XIfZ+p9aAQAArQIAABEAAAAAAAAAAAAAAAAAUgEAAE9FQlBTL2NvbnRlbnQub3BmUEsBAhQACgAAAAgAL0f1XDXoLbfYAAAAMwEAAA8AAAAAAAAAAAAAAAAA2wIAAE9FQlBTL25hdi54aHRtbFBLAQIUAAoAAAAIAC9H9VyeA/rmrAAAAM4AAAAUAAAAAAAAAAAAAAAAAOADAABPRUJQUy9jaGFwdGVyMS54aHRtbFBLAQIUAAoAAAAIAC9H9VwPIjdCrAAAAM4AAAAUAAAAAAAAAAAAAAAAAL4EAABPRUJQUy9jaGFwdGVyMi54aHRtbFBLBQYAAAAACAAIAOUBAACcBQAAAAA=';

async function exists(path) {
  try { await access(path, fsConstants.F_OK); return true; } catch { return false; }
}

function today() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

async function prepareFixture() {
  if (!(await exists(obsidianBin))) throw new Error(`Obsidian not found: ${obsidianBin}`);
  if (!(await exists(agentEntry))) throw new Error(`kos-agent is not built: ${agentEntry}`);
  await cp(join(repoRoot, 'vault'), vault, { recursive: true });
  await mkdir(pluginDir, { recursive: true });
  await mkdir(join(vault, '32_任务'), { recursive: true });
  await mkdir(join(vault, '31_项目'), { recursive: true });
  await mkdir(projectDir, { recursive: true });
  await mkdir(join(vault, '30_目标', goalPeriod), { recursive: true });
  await mkdir(join(vault, '42_个人操作画像'), { recursive: true });
  await mkdir(join(vault, '11_原材料'), { recursive: true });
  await mkdir(join(vault, '22_知识库'), { recursive: true });
  await mkdir(profile, { recursive: true });
  await mkdir(artifacts, { recursive: true });
  for (const file of ['main.js', 'manifest.json', 'styles.css']) await cp(join(pluginRoot, file), join(pluginDir, file));
  await cp(join(pluginRoot, 'assets'), join(pluginDir, 'assets'), { recursive: true });
  await writeFile(join(vault, '.obsidian', 'community-plugins.json'), JSON.stringify(['kos-companion']));
  await writeFile(join(vault, '.obsidian', 'appearance.json'), JSON.stringify({ baseFontSize: 16, theme: 'moonstone' }));
  await writeFile(join(profile, 'obsidian.json'), JSON.stringify({ vaults: { e2e: { path: vault, ts: Date.now(), open: true } } }));
  await writeFile(join(pluginDir, 'data.json'), JSON.stringify({
    version: 1,
    installDate: today(),
    lastSnapshotDate: today(),
    snapshots: {}, badges: {}, inboxZeroCount: 0, reviewClearCount: 0,
    settings: {
      staleThresholdDays: 3, heatmapIncludeDiary: true, enableBadges: false,
      reviewConfirmDialog: false, agentHostPath: agentEntry, agentNodePath: process.execPath,
      agentAutoStart: false, weekStart: 1,
    },
  }));
  await writeFile(goalPath, `---\ntype: goal\ntitle: 交付插件\nhorizon: ${goalPeriod.endsWith('H1') ? 'H1' : 'H2'}\nperiod: ${goalPeriod}\nstatus: active\nallocation_weight: 100\nhealth: on_track\nperiod_start: ${goalPeriod.slice(0, 4)}-${goalPeriod.endsWith('H1') ? '01-01' : '07-01'}\nperiod_end: ${goalPeriod.slice(0, 4)}-${goalPeriod.endsWith('H1') ? '06-30' : '12-31'}\ncreated: ${today()}\nupdated: ${today()}\nhuman_confirmed: true\nresult_evidence: []\nweight_history: []\ntags: [goal, kos-e2e]\n---\n# 交付插件\n\n## 期望结果\n\n- 完成真实 Obsidian 验收\n`);
  await writeFile(projectPath, `---\ntype: project\ntitle: 插件二期\nstatus: active\ncategory: coding\npriority: P0\nprimary_goal: "[[30_目标/${goalPeriod}/交付插件]]"\nsupporting_goals: []\ngoal_alignment: direct\nalignment_reviewed: ${today()}\nexploration_review_due: ""\nprocess_metrics:\n  - id: e2e\n    kind: process\n    name: 完成端到端场景数\n    unit: scenarios\n    baseline: 0\n    target: 1\n    current: 0\n    updated: ${today()}\n    evidence: []\nresult_metrics: []\ncurrent_stage: E2E\nnext_milestone: 完成真实 Obsidian 验收\ndue: ${today()}\noff_goal_override: false\noverride_reason: ""\noverride_review_due: ""\nvalidation_completed: false\nexpected_result_achieved: false\ncreated: ${today()}\nupdated: ${today()}\ntags: [kos-e2e]\n---\n`);
  await writeFile(join(vault, '42_个人操作画像', 'E2E能力强化.md'), `---\ntype: personal_operating_profile\ntitle: E2E 能力强化\nstatus: active\nconfidence: verified\ncreated: ${today()}\nupdated: ${today()}\nsources: [E2E]\nrelated_reflections: []\nrelated_methods: []\nrelated_projects: []\napplies_to_skills: [kos-start-my-day]\ncapability_focus:\n  period: ${goalPeriod}\n  name: 总结能力\n  behavior: 将复杂材料压缩为结构化结论\n  applies_to: [start-day, weekly-review, monthly-review]\n  max_daily_recommendations: 1\n  status: active\nreviewed: true\ntags: [kos-e2e]\n---\n`);
  await writeFile(taskPath, `---\ntype: task\ntitle: E2E 推进插件二期\nstatus: doing\nprojects: ["[[31_项目/插件二期/插件二期]]"]\npriority: P0\nscheduled_for: ""\ndefer_until: ""\ndue: ${today()}\nestimate_minutes: 30\nenergy: medium\nwork_mode: shallow\ngrowth_mode: neutral\nscheduled_times: ["09:00", "21:00"]\ncompleted: ""\nresult: ""\noutputs: []\nblocked_reason: ""\nunblock_condition: ""\nproject_contributions: []\nrecommendation_history: []\ncreated: ${today()}\ntags: [kos-e2e]\n---\n`);
  await writeFile(join(vault, '11_原材料', 'E2E示例.pdf'), Buffer.from(pdfFixture, 'base64'));
  await writeFile(join(vault, '11_原材料', 'E2E示例.epub'), Buffer.from(epubFixture, 'base64'));
  await writeFile(join(vault, '11_原材料', 'E2E直接打开.epub'), Buffer.from(epubFixture, 'base64'));
  for (let index = 1; index <= 12; index += 1) {
    const suffix = String(index).padStart(2, '0');
    const title = index === 12 ? longSourceTitle : `E2E 输入 ${suffix}`;
    const location = index === 2
      ? 'source_location: "[[11_原材料/E2E示例.pdf]]"\n'
      : index === 1
        ? 'source_location: "[[11_原材料/E2E示例.epub]]"\n'
        : '';
    await writeFile(join(vault, '11_原材料', `E2E输入${suffix}.md`), `---\ntype: source\ntitle: ${title}\nstatus: captured\nformat: article\nimportance: high\n${location}created: 2026-07-${suffix}\ntags: [kos-e2e]\n---\n`);
  }
  await writeFile(join(vault, '22_知识库', 'E2E概念.md'), `---\ntype: concept\ntitle: E2E 概念\nstatus: draft\nconfidence: draft\ncreated: ${today()}\nupdated: ${today()}\naliases: []\ntags: [kos-e2e]\n---\n`);
}

async function waitFor(fn, label, timeout = 30_000) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeout) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) { lastError = error; }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ''}`);
}

class Cdp {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.id = 0;
    this.pending = new Map();
    this.events = [];
  }

  async open() {
    await new Promise((resolveOpen, reject) => {
      this.socket.addEventListener('open', resolveOpen, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (!message.id) {
        if (message.method === 'Runtime.exceptionThrown' || message.method === 'Log.entryAdded') this.events.push(message);
        return;
      }
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }

  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolveSend, reject) => {
      this.pending.set(id, { resolve: resolveSend, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Runtime evaluation failed');
    return result.result.value;
  }

  close() { this.socket.close(); }
}

async function screenshot(cdp, name) {
  const result = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(join(artifacts, name), Buffer.from(result.data, 'base64'));
}

async function run() {
  await prepareFixture();
  const child = spawn(obsidianBin, [
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${port}`,
    '--disable-gpu',
    '--window-size=1440,1000',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += String(chunk); });
  let cdp;
  try {
    const target = await waitFor(async () => {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (!response.ok) return null;
      const pages = await response.json();
      return pages.find((page) => page.type === 'page' && page.webSocketDebuggerUrl);
    }, 'Obsidian CDP target', 45_000);
    cdp = new Cdp(target.webSocketDebuggerUrl);
    await cdp.open();
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await waitFor(() => cdp.evaluate(`Boolean(globalThis.app?.workspace?.layoutReady)`), 'Obsidian workspace', 45_000);
    await waitFor(() => cdp.evaluate(`Boolean(app.metadataCache.getFileCache(app.vault.getFileByPath('32_任务/E2E推进插件二期.md'))?.frontmatter)`), 'fixture metadata cache', 45_000);
    await cdp.evaluate(`localStorage.setItem('enable-plugin-e2e', 'true')`);
    const pluginLoad = await cdp.evaluate(`(async () => {
      try {
        if (app.plugins.plugins?.['kos-companion']) {
          await app.plugins.disablePlugin('kos-companion');
          await app.plugins.enablePlugin('kos-companion');
          return { loaded: Boolean(app.plugins.plugins?.['kos-companion']), reloaded: true };
        }
        await app.plugins.loadManifests();
        if (typeof app.plugins.loadPlugin === 'function') await app.plugins.loadPlugin('kos-companion');
        if (!app.plugins.plugins?.['kos-companion']) {
          await app.plugins.disablePlugin('kos-companion');
          await app.plugins.enablePlugin('kos-companion');
        }
        return {
          loaded: Boolean(app.plugins.plugins?.['kos-companion']),
          manifest: Boolean(app.plugins.manifests?.['kos-companion']),
          enabled: app.plugins.enabledPlugins?.has('kos-companion'),
        };
      } catch (error) {
        return { loaded: false, error: error?.stack || String(error) };
      }
    })()`);
    if (!pluginLoad.loaded) {
      try {
        await waitFor(() => cdp.evaluate(`(async () => {
          if (app.plugins.plugins?.['kos-companion']) return true;
          if (typeof app.plugins.loadPlugin === 'function') await app.plugins.loadPlugin('kos-companion');
          return Boolean(app.plugins.plugins?.['kos-companion']);
        })()`), 'kos plugin load', 60_000);
      } catch (error) {
        const manager = await cdp.evaluate(`(() => ({
          keys: Object.keys(app.plugins),
          methods: Object.getOwnPropertyNames(Object.getPrototypeOf(app.plugins)),
          enabled: [...app.plugins.enabledPlugins],
          manifests: Object.keys(app.plugins.manifests),
          loaded: Object.keys(app.plugins.plugins),
        }))()`);
        throw new Error(`${error.message}; pluginLoad=${JSON.stringify(pluginLoad)}; manager=${JSON.stringify(manager)}; events=${JSON.stringify(cdp.events.slice(-10))}`);
      }
    }
    await cdp.evaluate(`(() => {
      const modal = [...document.querySelectorAll('.modal-container')].find((el) => el.textContent.includes('Do you trust the author of this vault?'));
      if (!modal) return false;
      const trust = [...modal.querySelectorAll('button')].find((el) => el.textContent.includes('Trust author and enable plugins'));
      if (trust) trust.click();
      else modal.querySelector('.modal-close-button')?.click();
      return true;
    })()`);
    await waitFor(() => cdp.evaluate(`![...document.querySelectorAll('.modal-container')].some((el) => el.textContent.includes('Do you trust the author of this vault?'))`), 'trust prompt dismissal');
    await waitFor(() => cdp.evaluate(`Boolean(globalThis.app?.plugins?.plugins?.['kos-companion'])`), 'plugin after trust prompt');
    const commandInfo = await cdp.evaluate(`(() => ({
      exists: app.commands.listCommands().some((command) => command.id === 'kos-companion:open-dashboard'),
      result: app.commands.executeCommandById('kos-companion:open-dashboard'),
    }))()`);
    if (!commandInfo.exists || !commandInfo.result) {
      const commands = await cdp.evaluate(`app.commands.listCommands().filter((command) => /kos|dashboard|驾驶/i.test(command.id + command.name)).map((command) => command.id)`);
      throw new Error(`Dashboard command unavailable: ${JSON.stringify({ commandInfo, commands, events: cdp.events.slice(-5) })}`);
    }
    try {
    await waitFor(() => cdp.evaluate(`Boolean(document.querySelector('.kos-dashboard-v2 .kos-board-canvas'))`), 'phase-two dashboard');
    await waitFor(() => cdp.evaluate(`document.fonts.check('700 144px Doto', '20:37')`), 'bundled Doto font');
    await waitFor(() => cdp.evaluate(`document.querySelector('.kos-board-grid')?.dataset.bentoFitted === 'true'`), 'fitted Bento rows');
    } catch (error) {
      const diagnostics = await cdp.evaluate(`(() => ({
        leaves: app.workspace.getLeavesOfType('kos-dashboard').length,
        body: document.body.innerText.slice(-1000),
      }))()`);
      throw new Error(`${error.message}; diagnostics=${JSON.stringify(diagnostics)}; events=${JSON.stringify(cdp.events.slice(-5))}`);
    }

    const initial = await cdp.evaluate(`(() => ({
      sections: [...document.querySelectorAll('.kos-board-section')].map((el) => el.id),
      switchNavigation: document.querySelectorAll('.kos-nd-nav, .kos-board-jump').length,
      startButtons: [...document.querySelectorAll('.kos-board-button')].filter((el) => el.textContent.includes('开始一天')).length,
      agentLeaves: app.workspace.getLeavesOfType('kos-agent').length,
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      bentoDisplay: getComputedStyle(document.querySelector('.kos-board-grid')).display,
      bentoSizes: Object.fromEntries([...document.querySelectorAll('.kos-board-utility-card, .kos-board-section')].map((el) => [el.id || el.dataset.widget, el.dataset.bento])),
      bentoEffective: Object.fromEntries([...document.querySelectorAll('.kos-board-section')].map((el) => [el.id, el.dataset.bentoEffective])),
      cardRadii: [...document.querySelectorAll('.kos-dot-clock, .kos-day-schedule, .kos-goal-overview, .kos-year-progress, .kos-activity-heatmap, .kos-board-section')].map((el) => getComputedStyle(el).borderRadius),
      actionAnchors: [...document.querySelectorAll('#kos-board-action .kos-board-switch button')].map((el) => el.textContent),
      actionGoalCards: document.querySelectorAll('#kos-board-action .kos-board-goal-card').length,
      scheduleObjects: app.plugins.plugins['kos-companion'].index.getAll().filter((item) => item.type === 'task').map((item) => ({
        title: item.title, due: item.due, scheduledFor: item.scheduled_for, scheduledTimes: item.scheduled_times,
      })),
      internallyScrollable: [...document.querySelectorAll('.kos-board-section')]
        .filter((el) => el.scrollHeight > el.clientHeight + 1)
        .map((el) => el.id),
      sectionMetrics: [...document.querySelectorAll('.kos-board-section')].map((el) => ({
        id: el.id,
        clientHeight: el.clientHeight,
        scrollHeight: el.scrollHeight,
        contentHeight: el.querySelector('.kos-board-section-content')?.scrollHeight,
        effective: el.dataset.bentoEffective,
        paddingTop: getComputedStyle(el).paddingTop,
        paddingBottom: getComputedStyle(el).paddingBottom,
      })),
      clock: (() => {
        const root = document.querySelector('.kos-dot-clock');
        const rect = root?.getBoundingClientRect();
        return root ? {
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          time: root.querySelector('.kos-dot-clock-time')?.textContent,
          seconds: root.querySelector('.kos-dot-clock-seconds')?.textContent,
          calendarNodes: root.querySelectorAll('.kos-day-schedule-date, .kos-day-schedule-calendar').length,
          fontFamily: getComputedStyle(root.querySelector('.kos-dot-clock-time')).fontFamily,
        } : null;
      })(),
      schedule: (() => {
        const root = document.querySelector('.kos-day-schedule');
        const rect = root?.getBoundingClientRect();
        return root ? {
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          header: root.querySelector('.kos-day-schedule-head')?.textContent,
          time: root.querySelector('.kos-day-schedule-time')?.textContent,
          seconds: root.querySelector('.kos-day-schedule-seconds')?.textContent,
          next: root.querySelector('.kos-day-schedule-next')?.textContent,
          date: root.querySelector('.kos-day-schedule-date')?.textContent,
          calendarNodes: root.querySelectorAll('.kos-day-schedule-calendar').length,
          task: root.querySelector('.kos-day-schedule-task')?.textContent,
          taskTimes: root.querySelector('.kos-day-schedule-task-times')?.textContent,
          slots: root.querySelectorAll('.kos-day-schedule-rail span').length,
          scheduledSlots: root.querySelectorAll('.kos-day-schedule-rail span.is-scheduled').length,
          currentSlots: root.querySelectorAll('.kos-day-schedule-rail span.is-current').length,
          fontFamily: getComputedStyle(root.querySelector('.kos-day-schedule-time')).fontFamily,
        } : null;
      })(),
      goals: (() => {
        const root = document.querySelector('.kos-goal-overview');
        const rect = root?.getBoundingClientRect();
        return root ? {
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          header: root.querySelector('.kos-goal-overview-head')?.textContent,
          total: root.querySelector('.kos-goal-overview-total')?.textContent,
          name: root.querySelector('.kos-goal-overview-name')?.textContent,
          progress: root.querySelector('.kos-goal-overview-progress')?.textContent,
          segments: root.querySelectorAll('.kos-goal-overview-rail span').length,
          filled: root.querySelectorAll('.kos-goal-overview-rail span.is-filled').length,
          fontFamily: getComputedStyle(root.querySelector('.kos-goal-overview-total')).fontFamily,
        } : null;
      })(),
      progress: (() => {
        const root = document.querySelector('.kos-year-progress');
        const rect = root?.getBoundingClientRect();
        const rows = [...(root?.querySelectorAll('.kos-year-progress-row') ?? [])].map((row) => ({
          period: row.dataset.period,
          value: row.querySelector('.kos-year-progress-value')?.textContent,
          segments: row.querySelectorAll('.kos-year-progress-rail span').length,
          filled: row.querySelectorAll('.kos-year-progress-rail span.is-filled').length,
        }));
        return root ? {
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          header: root.querySelector('.kos-year-progress-head')?.textContent,
          hero: root.querySelector('.kos-year-progress-hero-value')?.textContent,
          count: root.querySelector('[data-period="year"] .kos-year-progress-count')?.textContent,
          fontFamily: getComputedStyle(root.querySelector('.kos-year-progress-hero-value')).fontFamily,
          updatedAt: root.dataset.updatedAt,
          rows,
        } : null;
      })(),
      heatmap: (() => {
        const root = document.querySelector('.kos-activity-heatmap');
        const rect = root?.getBoundingClientRect();
        return root ? {
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          header: root.querySelector('.kos-activity-heatmap-head')?.textContent,
          total: root.querySelector('.kos-activity-heatmap-total')?.textContent,
          range: root.querySelector('.kos-activity-heatmap-range')?.textContent,
          cells: root.querySelectorAll('.kos-activity-heatmap-grid .kos-activity-heatmap-cell:not(.is-blank)').length,
          today: root.querySelectorAll('.kos-activity-heatmap-cell.is-today').length,
          months: root.querySelectorAll('.kos-activity-heatmap-months span').length,
          fontFamily: getComputedStyle(root.querySelector('.kos-activity-heatmap-total')).fontFamily,
        } : null;
      })(),
    }))()`);
    if (initial.sections.length !== 6) throw new Error(`Expected 6 simultaneous sections, got ${initial.sections.length}`);
    if (initial.switchNavigation !== 0) throw new Error('Dashboard still contains module-switch navigation');
    if (initial.startButtons !== 1) throw new Error('Manual 开始一天 control is missing');
    if (initial.agentLeaves !== 0) throw new Error('Dashboard open unexpectedly activated Agent');
    if (initial.overflow) throw new Error('Desktop dashboard has horizontal overflow');
    if (initial.internallyScrollable.length) {
      throw new Error(`Dashboard sections must not scroll internally: ${initial.internallyScrollable.join(', ')}; metrics=${JSON.stringify(initial.sectionMetrics)}`);
    }
    if (initial.bentoDisplay !== 'grid') throw new Error(`Dashboard is not a Bento grid: ${initial.bentoDisplay}`);
    if (initial.cardRadii.some((radius) => radius !== '30px')) throw new Error(`Dashboard card radii differ: ${JSON.stringify(initial.cardRadii)}`);
    if (!initial.clock) throw new Error('Dot clock is missing');
    if (!initial.clock.fontFamily.includes('Doto') || !/^\d{2}:\d{2}$/.test(initial.clock.time) || !/^\d{2}$/.test(initial.clock.seconds)) {
      throw new Error(`Dot clock typography or time differs: ${JSON.stringify(initial.clock)}`);
    }
    if (initial.clock.calendarNodes !== 0) {
      throw new Error(`Dot clock still contains moved calendar metadata: ${JSON.stringify(initial.clock)}`);
    }
    if (!initial.schedule || !initial.schedule.header?.includes('SCHEDULE') || !initial.schedule.header.includes('任务时刻') || !/^\d{2}:\d{2}$/.test(initial.schedule.time) || !/^\d{2}$/.test(initial.schedule.seconds)) {
      throw new Error(`Day schedule header or clock differs: ${JSON.stringify(initial.schedule)}`);
    }
    if (!initial.schedule.date?.includes('年') || !initial.schedule.date.includes('星期') || initial.schedule.calendarNodes !== 0) {
      throw new Error(`Day schedule date or removed calendar row differs: ${JSON.stringify(initial.schedule)}`);
    }
    if (!initial.schedule.fontFamily.includes('Doto') || initial.schedule.task !== 'E2E 推进插件二期' || initial.schedule.taskTimes !== '09:00 / 21:00' || initial.schedule.slots !== 48 || initial.schedule.scheduledSlots !== 2 || initial.schedule.currentSlots !== 1) {
      throw new Error(`Day schedule data or timeline differs: ${JSON.stringify({ schedule: initial.schedule, tasks: initial.scheduleObjects })}`);
    }
    if (!initial.goals || !initial.goals.header?.includes('GOALS') || !initial.goals.header.includes('目标') || !initial.goals.header.includes(goalPeriod)) {
      throw new Error(`Goal overview header differs: ${JSON.stringify(initial.goals)}`);
    }
    if (!initial.goals.fontFamily.includes('Doto') || initial.goals.total !== '100' || initial.goals.name !== '交付插件' || initial.goals.progress !== '—' || initial.goals.segments !== 20 || initial.goals.filled !== 0) {
      throw new Error(`Goal overview data differs: ${JSON.stringify(initial.goals)}`);
    }
    if (JSON.stringify(initial.actionAnchors) !== JSON.stringify(['项目', '任务']) || initial.actionGoalCards !== 0) {
      throw new Error(`Action section duplicates Goal content: ${JSON.stringify({ anchors: initial.actionAnchors, cards: initial.actionGoalCards })}`);
    }
    if (!initial.progress || !initial.progress.header?.includes('PROGRESS') || !initial.progress.header.includes('A.D. 2026')) {
      throw new Error(`Year progress header differs: ${JSON.stringify(initial.progress)}`);
    }
    if (!initial.progress.fontFamily.includes('Doto') || !/^\d{1,3}\.\d%$/.test(initial.progress.hero) || !/^\d+\/\d+$/.test(initial.progress.count)) {
      throw new Error(`Year progress typography or summary differs: ${JSON.stringify(initial.progress)}`);
    }
    if (initial.progress.rows.length !== 4 || initial.progress.rows.some((row) => row.segments !== 50 || Math.abs(row.filled - Math.round(Number.parseFloat(row.value) / 2)) > 1)) {
      throw new Error(`Year progress segmented rails differ: ${JSON.stringify(initial.progress.rows)}`);
    }
    if (!initial.heatmap || !initial.heatmap.header?.includes('HEATMAP') || !initial.heatmap.header.includes('热点图') || !initial.heatmap.header.includes('LIVE DATA')) {
      throw new Error(`Activity heatmap header differs: ${JSON.stringify(initial.heatmap)}`);
    }
    if (!initial.heatmap.fontFamily.includes('Doto') || !/^\d+$/.test(initial.heatmap.total) || initial.heatmap.cells !== 365 || initial.heatmap.today !== 1 || initial.heatmap.months < 12 || !initial.heatmap.range?.includes('—')) {
      throw new Error(`Activity heatmap data differs: ${JSON.stringify(initial.heatmap)}`);
    }
    await waitFor(() => cdp.evaluate(`${JSON.stringify(initial.clock.seconds)} !== document.querySelector('.kos-dot-clock-seconds')?.textContent`), 'dot clock second tick', 3_000);
    await waitFor(() => cdp.evaluate(`${JSON.stringify(initial.progress.updatedAt)} !== document.querySelector('.kos-year-progress')?.dataset.updatedAt`), 'year progress second tick', 3_000);
    const expectedBentoSizes = {
      clock: '7x6', schedule: '7x12', goals: '10x8', progress: '10x12', heatmap: '10x7',
      'kos-board-today': '9x7', 'kos-board-action': '6x10', 'kos-board-input': '6x10',
      'kos-board-knowledge': '3x7', 'kos-board-review': '9x7', 'kos-board-system': '3x7',
    };
    if (JSON.stringify(initial.bentoSizes) !== JSON.stringify(expectedBentoSizes)) {
      throw new Error(`Dashboard Bento sizes differ: ${JSON.stringify(initial.bentoSizes)}`);
    }
    await screenshot(cdp, 'dashboard-today-desktop.png');

    await cdp.evaluate(`[...document.querySelectorAll('.kos-board-button')].find((button) => button.textContent === '开始一天')?.click()`);
    await waitFor(() => cdp.evaluate(`Boolean([...document.querySelectorAll('.modal-container button')].find((button) => button.textContent === '生成建议'))`), 'start day constraints dialog');
    await cdp.evaluate(`[...document.querySelectorAll('.modal-container button')].find((button) => button.textContent === '生成建议')?.click()`);
    await waitFor(() => cdp.evaluate(`(() => [...document.querySelectorAll('#kos-board-today .kos-board-focus-card')].some((card) => card.textContent.includes('E2E 推进插件二期') && [...card.querySelectorAll('button')].some((button) => button.textContent === '接受')))()`), 'structured Agent daily recommendations', 30_000);
    const recommendationState = await cdp.evaluate(`(() => {
      const cards = [...document.querySelectorAll('#kos-board-today .kos-board-focus-card')];
      const recommendation = cards.find((card) => card.textContent.includes('E2E 推进插件二期') && [...card.querySelectorAll('button')].some((button) => button.textContent === '接受'));
      return { found: Boolean(recommendation), capability: recommendation?.textContent.includes('能力强化'), actions: [...(recommendation?.querySelectorAll('button') ?? [])].map((button) => button.textContent) };
    })()`);
    if (!recommendationState.found || !recommendationState.actions.includes('调整') || !recommendationState.actions.includes('推迟') || !recommendationState.actions.includes('拒绝')) throw new Error(`Daily recommendation feedback controls differ: ${JSON.stringify(recommendationState)}`);
    await cdp.evaluate(`(() => {
      const card = [...document.querySelectorAll('#kos-board-today .kos-board-focus-card')].find((item) => item.textContent.includes('E2E 推进插件二期') && [...item.querySelectorAll('button')].some((button) => button.textContent === '接受'));
      card && [...card.querySelectorAll('button')].find((button) => button.textContent === '接受')?.click();
    })()`);
    await waitFor(async () => (await readFile(taskPath, 'utf8')).includes(`scheduled_for: ${today()}`) || (await readFile(taskPath, 'utf8')).includes(`scheduled_for: "${today()}"`), 'accepted recommendation persisted');
    const planPath = join(vault, '00_工作台', '计划', `${today()}.md`);
    await waitFor(async () => (await exists(planPath)) && (await readFile(planPath, 'utf8')).includes('status: accepted'), 'daily plan feedback persisted');
    await screenshot(cdp, 'dashboard-daily-recommendations.png');

    const desktopSplitState = await cdp.evaluate(`({
      leftCollapsed: app.workspace.leftSplit.collapsed,
      rightCollapsed: app.workspace.rightSplit.collapsed,
    })`);
    await cdp.evaluate(`(async () => {
      await app.workspace.leftSplit.collapse();
      await app.workspace.rightSplit.collapse();
    })()`);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1800, height: 1000, deviceScaleFactor: 1, mobile: false });
    const wideBento = await waitFor(() => cdp.evaluate(`(() => {
      const grid = document.querySelector('.kos-board-grid');
      if (grid?.dataset.bentoFitted !== 'true') return null;
      const rect = (id) => document.querySelector(id).getBoundingClientRect();
      const today = rect('#kos-board-today');
      const action = rect('#kos-board-action');
      const input = rect('#kos-board-input');
      const knowledge = rect('#kos-board-knowledge');
      const review = rect('#kos-board-review');
      const system = rect('#kos-board-system');
      const clock = rect('.kos-dot-clock');
      const schedule = rect('.kos-day-schedule');
      const goals = rect('.kos-goal-overview');
      const progress = rect('.kos-year-progress');
      const heatmap = rect('.kos-activity-heatmap');
      const columns = getComputedStyle(grid).gridTemplateColumns.split(' ').length;
      const result = {
        columns,
        gridWidth: grid.getBoundingClientRect().width,
        paired: today.top === knowledge.top && today.bottom === knowledge.bottom
          && action.top === input.top && action.bottom === input.bottom
          && review.top === system.top && review.bottom === system.bottom,
        effective: Object.fromEntries([...document.querySelectorAll('.kos-board-section')].map((el) => [el.id, el.dataset.bentoEffective])),
        clock: { width: Math.round(clock.width), height: Math.round(clock.height) },
        schedule: { width: Math.round(schedule.width), height: Math.round(schedule.height) },
        goals: { width: Math.round(goals.width), height: Math.round(goals.height) },
        progress: { width: Math.round(progress.width), height: Math.round(progress.height) },
        heatmap: { width: Math.round(heatmap.width), height: Math.round(heatmap.height) },
      };
      const cellWidth = (result.gridWidth - 11 * 16) / 12;
      const width = (span) => Math.round(cellWidth * span + 16 * (span - 1));
      const height = (span) => span * 42 + (span - 1) * 16;
      return result.columns === 12 && result.paired
        && result.clock.width === width(7) && result.clock.height === height(6)
        && result.schedule.width === width(7) && result.schedule.height === height(12)
        && result.goals.width === width(10) && result.goals.height === height(8)
        && result.progress.width === width(10) && result.progress.height === height(12)
        && result.heatmap.width === width(10) && result.heatmap.height === height(7) ? result : null;
    })()`), 'wide twelve-column Bento layout');
    await cdp.evaluate(`document.querySelector('.kos-dot-clock').scrollIntoView({ block: 'start' })`);
    await screenshot(cdp, 'dashboard-clock-reference.png');
    await cdp.evaluate(`document.querySelector('.kos-year-progress').scrollIntoView({ block: 'start' })`);
    await screenshot(cdp, 'dashboard-year-progress-reference.png');
    await cdp.evaluate(`document.querySelector('.kos-day-schedule').scrollIntoView({ block: 'start' })`);
    await screenshot(cdp, 'dashboard-day-schedule-reference.png');
    await cdp.evaluate(`document.querySelector('.kos-goal-overview').scrollIntoView({ block: 'start' })`);
    await screenshot(cdp, 'dashboard-goal-overview-reference.png');
    await cdp.evaluate(`document.querySelector('.kos-activity-heatmap').scrollIntoView({ block: 'start' })`);
    await screenshot(cdp, 'dashboard-activity-heatmap-reference.png');
    await screenshot(cdp, 'dashboard-bento-wide.png');

    await cdp.evaluate(`document.querySelector('.kos-bento-toolbar-button[aria-label="编辑看板布局"]').click()`);
    await waitFor(() => cdp.evaluate(`document.querySelector('.kos-board-grid')?.dataset.bentoEditing === 'true' && document.querySelectorAll('.kos-bento-drag-handle').length === 11 && document.querySelectorAll('.kos-bento-drag-handle.is-size-only').length === 0 && document.querySelectorAll('.kos-bento-resize-zone').length === 88 && [...document.querySelectorAll('.kos-board-section, .kos-board-utility-card')].every((card) => card.querySelectorAll('.kos-bento-resize-zone').length === 8) && document.querySelectorAll('.kos-bento-grid-guide span').length >= 120`), 'dashboard layout edit mode');
    await screenshot(cdp, 'dashboard-bento-edit-mode.png');
    await cdp.evaluate(`document.querySelector('.kos-board-utility-card.is-clock').scrollIntoView({ block: 'center' })`);
    const utilityResizeStart = await cdp.evaluate(`(() => {
      const card = document.querySelector('.kos-board-utility-card.is-clock');
      const rect = card.querySelector('.kos-bento-resize-zone.is-e').getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: utilityResizeStart.x, y: utilityResizeStart.y, button: 'none', buttons: 0 });
    await waitFor(() => cdp.evaluate(`(() => {
      const card = document.querySelector('.kos-board-utility-card.is-clock');
      const handle = card.querySelector('.kos-bento-resize-zone.is-e');
      return getComputedStyle(handle, '::after').opacity === '1'
        && getComputedStyle(handle, '::after').backgroundColor === 'rgb(22, 119, 255)'
        && getComputedStyle(card.querySelector('.kos-dot-clock')).borderColor === 'rgb(22, 119, 255)';
    })()`), 'blue clock resize hover');
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: utilityResizeStart.x, y: utilityResizeStart.y, button: 'left', buttons: 1, clickCount: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: utilityResizeStart.x + 120, y: utilityResizeStart.y, button: 'left', buttons: 1 });
    await waitFor(() => cdp.evaluate(`document.querySelector('.kos-board-utility-card.is-clock')?.classList.contains('is-layout-resizing') && document.querySelector('.kos-board-utility-card.is-clock')?.dataset.bento === '8x6' && !document.querySelector('.kos-bento-drag-overlay')`), 'clock Bento resize preview');
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: utilityResizeStart.x + 120, y: utilityResizeStart.y, button: 'left', buttons: 0, clickCount: 1 });
    await waitFor(() => cdp.evaluate(`app.plugins.plugins['kos-companion'].store.getDashboardLayout().find((item) => item.id === 'clock')?.w === 8`), 'persisted clock Bento resize');
    await screenshot(cdp, 'dashboard-clock-resized.png');
    await cdp.evaluate(`document.querySelector('.kos-bento-toolbar-button[aria-label="撤销布局调整"]').click()`);
    await waitFor(() => cdp.evaluate(`app.plugins.plugins['kos-companion'].store.getDashboardLayout().find((item) => item.id === 'clock')?.w === 7`), 'clock resize undo');
    await cdp.evaluate(`document.querySelector('.kos-bento-toolbar-button[aria-label="重做布局调整"]').click()`);
    await waitFor(() => cdp.evaluate(`app.plugins.plugins['kos-companion'].store.getDashboardLayout().find((item) => item.id === 'clock')?.w === 8`), 'clock resize redo');
    await cdp.evaluate(`document.querySelector('.kos-bento-toolbar-button[aria-label="恢复默认布局"]').click()`);
    await waitFor(() => cdp.evaluate(`(() => { const layout = app.plugins.plugins['kos-companion'].store.getDashboardLayout(); return layout.find((item) => item.id === 'clock')?.w === 7 && layout.find((item) => item.id === 'schedule')?.w === 7 && layout.find((item) => item.id === 'goals')?.w === 10 && layout.find((item) => item.id === 'progress')?.w === 10 && layout.find((item) => item.id === 'heatmap')?.w === 10; })()`), 'unified layout reset');
    await cdp.evaluate(`document.querySelector('.kos-board-utility-card.is-progress').scrollIntoView({ block: 'center' })`);
    const progressResizeStart = await cdp.evaluate(`(() => {
      const rect = document.querySelector('.kos-board-utility-card.is-progress .kos-bento-resize-zone.is-se').getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: progressResizeStart.x, y: progressResizeStart.y, button: 'left', buttons: 1, clickCount: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: progressResizeStart.x + 80, y: progressResizeStart.y + 60, button: 'left', buttons: 1 });
    await waitFor(() => cdp.evaluate(`document.querySelector('.kos-board-utility-card.is-progress')?.dataset.bento === '11x13' && !document.querySelector('.kos-bento-drag-overlay')`), 'year progress Bento resize preview');
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: progressResizeStart.x + 80, y: progressResizeStart.y + 60, button: 'left', buttons: 0, clickCount: 1 });
    await waitFor(() => cdp.evaluate(`(() => { const item = app.plugins.plugins['kos-companion'].store.getDashboardLayout().find((candidate) => candidate.id === 'progress'); return item?.w === 11 && item?.h === 13; })()`), 'persisted year progress Bento resize');
    await cdp.evaluate(`document.querySelector('.kos-bento-toolbar-button[aria-label="撤销布局调整"]').click()`);
    await waitFor(() => cdp.evaluate(`(() => { const item = app.plugins.plugins['kos-companion'].store.getDashboardLayout().find((candidate) => candidate.id === 'progress'); return item?.w === 10 && item?.h === 12; })()`), 'year progress resize undo');
    await cdp.evaluate(`document.querySelector('#kos-board-today').scrollIntoView({ block: 'center' })`);
    const dragStart = await cdp.evaluate(`(() => {
      const rect = document.querySelector('#kos-board-today .kos-bento-drag-handle').getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: dragStart.x, y: dragStart.y, button: 'left', buttons: 1, clickCount: 1 });
    await new Promise((resolveWait) => setTimeout(resolveWait, 80));
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: dragStart.x + 210, y: dragStart.y, button: 'left', buttons: 1 });
    await new Promise((resolveWait) => setTimeout(resolveWait, 120));
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: dragStart.x + 405, y: dragStart.y, button: 'left', buttons: 1 });
    await new Promise((resolveWait) => setTimeout(resolveWait, 120));
    await waitFor(() => cdp.evaluate(`Boolean(document.querySelector('.kos-bento-drag-overlay') && document.querySelector('#kos-board-today')?.classList.contains('is-layout-active'))`), 'Bento drag overlay');
    await screenshot(cdp, 'dashboard-bento-dragging.png');
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: dragStart.x + 405, y: dragStart.y, button: 'left', buttons: 0, clickCount: 1 });
    try {
      await waitFor(() => cdp.evaluate(`app.plugins.plugins['kos-companion'].store.getDashboardLayout().find((item) => item.id === 'today')?.x === 3 && document.querySelector('#kos-board-today')?.dataset.bentoX === '3'`), 'persisted Bento drag', 8_000);
    } catch (error) {
      const dragDiagnostics = await cdp.evaluate(`({
        saved: app.plugins.plugins['kos-companion'].store.getDashboardLayout(),
        sectionX: document.querySelector('#kos-board-today')?.dataset.bentoX,
        active: document.querySelector('#kos-board-today')?.classList.contains('is-layout-active'),
        overlay: Boolean(document.querySelector('.kos-bento-drag-overlay')),
      })`);
      throw new Error(`${error.message}; drag=${JSON.stringify(dragDiagnostics)}`);
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 600));
    const customLayout = await cdp.evaluate(`(() => {
      const sections = [...document.querySelectorAll('.kos-board-utility-card, .kos-board-section')];
      const rects = sections.map((element) => ({ id: element.id, rect: element.getBoundingClientRect() }));
      const overlaps = [];
      for (let i = 0; i < rects.length; i += 1) for (let j = i + 1; j < rects.length; j += 1) {
        const a = rects[i]; const b = rects[j];
        if (a.rect.left < b.rect.right && a.rect.right > b.rect.left && a.rect.top < b.rect.bottom && a.rect.bottom > b.rect.top) overlaps.push([a.id, b.id]);
      }
      return { overlaps, positions: Object.fromEntries(sections.map((element) => [element.id, { x: element.dataset.bentoX, y: element.dataset.bentoY }])) };
    })()`);
    if (customLayout.overlaps.length) throw new Error(`Custom Bento layout overlaps: ${JSON.stringify(customLayout)}`);
    await screenshot(cdp, 'dashboard-bento-dragged.png');
    await cdp.evaluate(`document.querySelector('.kos-bento-toolbar-button[aria-label="撤销布局调整"]').click()`);
    await waitFor(() => cdp.evaluate(`app.plugins.plugins['kos-companion'].store.getDashboardLayout().find((item) => item.id === 'today')?.x === 0`), 'Bento undo');
    await cdp.evaluate(`document.querySelector('.kos-bento-toolbar-button[aria-label="重做布局调整"]').click()`);
    await waitFor(() => cdp.evaluate(`app.plugins.plugins['kos-companion'].store.getDashboardLayout().find((item) => item.id === 'today')?.x === 3`), 'Bento redo');
    await cdp.evaluate(`document.querySelector('.kos-bento-toolbar-button[aria-label="恢复默认布局"]').click()`);
    await waitFor(() => cdp.evaluate(`app.plugins.plugins['kos-companion'].store.getDashboardLayout().find((item) => item.id === 'today')?.x === 0`), 'Bento reset');

    await cdp.evaluate(`document.querySelector('#kos-board-today').scrollIntoView({ block: 'start' })`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
    const resizeStart = await cdp.evaluate(`(() => {
      const card = document.querySelector('#kos-board-today');
      const rect = card.querySelector('.kos-bento-resize-zone.is-s').getBoundingClientRect();
      return {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        effectiveRows: Number(card.dataset.bentoEffective.split('x')[1]),
      };
    })()`);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: resizeStart.x, y: resizeStart.y, button: 'none', buttons: 0 });
    const resizeHover = await waitFor(() => cdp.evaluate(`(() => {
      const handle = document.querySelector('#kos-board-today .kos-bento-resize-zone.is-s');
      const card = document.querySelector('#kos-board-today');
      const indicator = getComputedStyle(handle, '::after');
      const result = {
        opacity: indicator.opacity,
        color: indicator.backgroundColor,
        borderColor: getComputedStyle(card).borderColor,
        hitAreaBackground: getComputedStyle(handle).backgroundColor,
        hitAreaShadow: getComputedStyle(handle).boxShadow,
      };
      return result.opacity === '1'
        && result.color === 'rgb(22, 119, 255)'
        && result.hitAreaBackground === 'rgba(0, 0, 0, 0)'
        && result.hitAreaShadow === 'none' ? result : null;
    })()`), 'blue Bento edge hover');
    await screenshot(cdp, 'dashboard-bento-edge-hover.png');
    const cornerHover = await cdp.evaluate(`(() => {
      const rect = document.querySelector('#kos-board-today .kos-bento-resize-zone.is-se').getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cornerHover.x, y: cornerHover.y, button: 'none', buttons: 0 });
    await waitFor(() => cdp.evaluate(`(() => {
      const handle = document.querySelector('#kos-board-today .kos-bento-resize-zone.is-se');
      const indicator = getComputedStyle(handle, '::after');
      const endCaps = getComputedStyle(handle, '::before');
      return indicator.opacity === '1'
        && indicator.backgroundColor === 'rgba(0, 0, 0, 0)'
        && indicator.borderRightColor === 'rgb(22, 119, 255)'
        && indicator.borderBottomColor === 'rgb(22, 119, 255)'
        && indicator.borderBottomRightRadius === '33px'
        && endCaps.opacity === '1'
        && endCaps.width === '7px'
        && endCaps.height === '7px'
        && endCaps.borderRadius === '50%'
        && endCaps.boxShadow !== 'none';
    })()`), 'rounded blue Bento corner hover');
    await screenshot(cdp, 'dashboard-bento-corner-hover.png');
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: resizeStart.x, y: resizeStart.y, button: 'none', buttons: 0 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: resizeStart.x, y: resizeStart.y, button: 'left', buttons: 1, clickCount: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: resizeStart.x, y: resizeStart.y + 392, button: 'left', buttons: 1 });
    await waitFor(() => cdp.evaluate(`document.querySelector('#kos-board-today')?.classList.contains('is-layout-resizing') && !document.querySelector('#kos-board-today')?.classList.contains('is-layout-active') && !document.querySelector('.kos-bento-drag-overlay') && document.querySelector('#kos-board-today')?.dataset.resizeDirection === 's'`), 'Bento edge resize state');
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: resizeStart.x, y: resizeStart.y + 392, button: 'left', buttons: 0, clickCount: 1 });
    const expectedResizeRows = resizeStart.effectiveRows + 7;
    await waitFor(() => cdp.evaluate(`app.plugins.plugins['kos-companion'].store.getDashboardLayout().find((item) => item.id === 'today')?.h === ${expectedResizeRows} && document.querySelector('#kos-board-today')?.dataset.bento === ${JSON.stringify(`9x${expectedResizeRows}`)}`), 'persisted Bento resize');
    await screenshot(cdp, 'dashboard-bento-resized.png');
    await waitFor(() => cdp.evaluate(`!document.querySelector('.kos-bento-toolbar-button[aria-label="撤销布局调整"]')?.disabled`), 'Bento resize undo control');
    await cdp.evaluate(`document.querySelector('.kos-bento-toolbar-button[aria-label="撤销布局调整"]').click()`);
    await waitFor(() => cdp.evaluate(`app.plugins.plugins['kos-companion'].store.getDashboardLayout().find((item) => item.id === 'today')?.h === 7`), 'Bento resize undo');
    await cdp.evaluate(`document.querySelector('.kos-bento-toolbar-button[aria-label="完成布局编辑"]').click()`);
    await waitFor(() => cdp.evaluate(`document.querySelector('.kos-board-grid')?.dataset.bentoEditing === 'false' && document.querySelectorAll('.kos-bento-drag-handle').length === 0 && document.querySelectorAll('.kos-bento-resize-zone').length === 0`), 'locked dashboard layout');
    await cdp.send('Emulation.clearDeviceMetricsOverride');
    await cdp.evaluate(`(async () => {
      if (!${JSON.stringify(desktopSplitState.leftCollapsed)}) await app.workspace.leftSplit.expand();
      if (!${JSON.stringify(desktopSplitState.rightCollapsed)}) await app.workspace.rightSplit.expand();
    })()`);

    await cdp.evaluate(`document.body.classList.remove('theme-light'); document.body.classList.add('theme-dark')`);
    const darkBackground = await cdp.evaluate(`getComputedStyle(document.querySelector('.kos-dashboard-v2')).backgroundColor`);
    if (darkBackground !== 'rgb(0, 0, 0)') throw new Error(`OLED theme token did not apply: ${darkBackground}`);
    await screenshot(cdp, 'dashboard-today-dark.png');
    await cdp.evaluate(`document.body.classList.remove('theme-dark'); document.body.classList.add('theme-light')`);

    await cdp.evaluate(`document.querySelector('#kos-board-input').scrollIntoView({ block: 'start' })`);
    await screenshot(cdp, 'dashboard-input-desktop.png');
    const inputFirstPage = await cdp.evaluate(`(() => ({
      rows: document.querySelectorAll('#kos-board-input .kos-board-lines .kos-board-line').length,
      label: document.querySelector('#kos-board-input .kos-board-pagination-label')?.textContent,
    }))()`);
    if (inputFirstPage.rows !== 5 || !inputFirstPage.label?.includes('1–5 / 12')) {
      throw new Error(`Input first page is not capped at 5: ${JSON.stringify(inputFirstPage)}`);
    }
    const sourceTitle = await cdp.evaluate(`(() => {
      const link = document.querySelector('#kos-board-input .kos-board-link.is-truncated');
      return link ? { text: link.textContent, title: link.title, ariaLabel: link.getAttribute('aria-label') } : null;
    })()`);
    const expectedSourceTitle = `${Array.from(longSourceTitle).slice(0, 24).join('')}…`;
    if (sourceTitle?.text !== expectedSourceTitle || sourceTitle.title !== longSourceTitle || sourceTitle.ariaLabel !== longSourceTitle) {
      throw new Error(`Source title truncation differs: ${JSON.stringify({ sourceTitle, expectedSourceTitle })}`);
    }
    await cdp.evaluate(`document.querySelector('#kos-board-input .kos-board-page-button[aria-label="下一页"]').click()`);
    await waitFor(() => cdp.evaluate(`document.querySelectorAll('#kos-board-input .kos-board-lines .kos-board-line').length === 5 && document.querySelector('#kos-board-input .kos-board-pagination-label')?.textContent?.includes('6–10 / 12')`), 'input second page');
    await screenshot(cdp, 'dashboard-input-page-2-desktop.png');
    await cdp.evaluate(`document.querySelector('#kos-board-knowledge').scrollIntoView({ block: 'start' })`);
    await screenshot(cdp, 'dashboard-knowledge-desktop.png');
    await cdp.evaluate(`document.querySelector('#kos-board-review').scrollIntoView({ block: 'start' })`);
    await screenshot(cdp, 'dashboard-review-desktop.png');
    await cdp.evaluate(`document.querySelector('#kos-board-input .kos-board-page-button[aria-label="下一页"]').click()`);
    await waitFor(() => cdp.evaluate(`document.querySelector('#kos-board-input .kos-board-pagination-label')?.textContent?.includes('11–12 / 12') && [...document.querySelectorAll('#kos-board-input .kos-board-line')].some((el) => el.textContent.includes('E2E 输入 02'))`), 'input third page with PDF source');
    await cdp.evaluate(`[...document.querySelectorAll('#kos-board-input .kos-board-line')].find((el) => el.textContent.includes('E2E 输入 02')).querySelector('[aria-label="在 Reader 中阅读"]').click()`);
    await waitFor(() => cdp.evaluate(`app.workspace.activeLeaf?.view?.getViewType?.() === 'kos-reader' && document.querySelector('.kos-reader-document[data-reader-kind="pdf"] .kos-reader-pdf-canvas')?.width > 0 && document.querySelector('.kos-reader-position')?.textContent === '1 / 2' && !document.querySelector('.kos-reader-toolbar [aria-label="下一页"]').disabled`), 'rendered PDF Reader');
    const pdfScrollLayout = await cdp.evaluate(`(() => {
      const host = document.querySelector('.kos-reader-adapter-host');
      return {
        pages: document.querySelectorAll('.kos-reader-pdf-page').length,
        clientHeight: host?.clientHeight ?? 0,
        scrollHeight: host?.scrollHeight ?? 0,
      };
    })()`);
    if (pdfScrollLayout.pages !== 2 || pdfScrollLayout.scrollHeight <= pdfScrollLayout.clientHeight) {
      throw new Error(`PDF is not a continuous scroll layout: ${JSON.stringify(pdfScrollLayout)}`);
    }
    const readerState = await cdp.evaluate(`({ readerLeaves: app.workspace.getLeavesOfType('kos-reader').length, dashboardLeaves: app.workspace.getLeavesOfType('kos-dashboard').length })`);
    if (readerState.readerLeaves !== 1 || readerState.dashboardLeaves !== 1) throw new Error(`Reader is not independent: ${JSON.stringify(readerState)}`);
    await waitFor(() => cdp.evaluate(`Boolean(document.querySelector('.kos-reader-pdf-page[data-page="1"] .kos-reader-pdf-text-layer')?.textContent?.trim())`), 'PDF text layer');
    const pdfTextRect = await cdp.evaluate(`(() => {
      const layer = document.querySelector('.kos-reader-pdf-page[data-page="1"] .kos-reader-pdf-text-layer');
      const target = [...(layer?.querySelectorAll('span, [role="presentation"]') || [])].find((element) => element.textContent?.trim()) || layer;
      if (!target) return null;
      const rect = target.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, text: target.textContent?.trim() || '' };
    })()`);
    if (!pdfTextRect?.text || pdfTextRect.width <= 4) throw new Error(`PDF text layer did not expose selectable text: ${JSON.stringify(pdfTextRect)}`);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pdfTextRect.x + 2, y: pdfTextRect.y + pdfTextRect.height / 2, button: 'left', buttons: 1, clickCount: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pdfTextRect.x + pdfTextRect.width - 2, y: pdfTextRect.y + pdfTextRect.height / 2, button: 'left', buttons: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pdfTextRect.x + pdfTextRect.width - 2, y: pdfTextRect.y + pdfTextRect.height / 2, button: 'left', buttons: 0, clickCount: 1 });
    const selectedPdfText = await waitFor(() => cdp.evaluate(`document.getSelection()?.toString()?.trim() || null`), 'PDF text selection');
    await waitFor(() => cdp.evaluate(`Boolean([...document.querySelectorAll('.kos-reader-selection-action')].find((el) => el.textContent.includes('划线')))`), 'PDF highlight action');
    await cdp.evaluate(`[...document.querySelectorAll('.kos-reader-selection-action')].find((el) => el.textContent.includes('划线')).click()`);
    await waitFor(() => exists(readerPdfExtractPath), 'PDF Reader Extract creation', 45_000);
    await waitFor(() => cdp.evaluate(`document.querySelectorAll('.kos-reader-pdf-highlight[data-annotation-id]').length === 1`), 'PDF rectangle highlight');
    const pdfExtract = await readFile(readerPdfExtractPath, 'utf8');
    if (!pdfExtract.includes(selectedPdfText) || !pdfExtract.includes('"format":"pdf"') || !pdfExtract.includes('"rects":[')) {
      throw new Error(`PDF Reader annotation is incomplete: ${pdfExtract.slice(0, 1000)}`);
    }
    await cdp.evaluate(`document.querySelector('.kos-reader-toolbar [aria-label="下一页"]').click()`);
    await waitFor(() => cdp.evaluate(`document.querySelector('.kos-reader-position')?.textContent === '2 / 2' && document.querySelector('.kos-reader-adapter-host')?.scrollTop > 0`), 'PDF scroll to next page');
    await waitFor(() => cdp.evaluate(`app.plugins.plugins['kos-companion'].store.getReaderProgress('11_原材料/E2E输入02.md')?.location === 'page:2'`), 'persisted PDF progress');
    await screenshot(cdp, 'reader-pdf-desktop.png');

    await cdp.evaluate(`document.querySelector('.kos-reader-header [aria-label="返回看板"]').click()`);
    await waitFor(() => cdp.evaluate(`app.workspace.activeLeaf?.view?.getViewType?.() === 'kos-dashboard' && document.querySelector('#kos-board-input')?.getClientRects().length > 0`), 'return to input section');
    await cdp.evaluate(`[...document.querySelectorAll('#kos-board-input .kos-board-line')].find((el) => el.textContent.includes('E2E 输入 01')).querySelector('[aria-label="在 Reader 中阅读"]').click()`);
    await waitFor(() => cdp.evaluate(`app.workspace.activeLeaf?.view?.getViewType?.() === 'kos-reader' && Boolean(document.querySelector('.kos-reader-document[data-reader-kind="epub"] iframe')) && Boolean(document.querySelector('.kos-reader-document').dataset.readerLocation) && !document.querySelector('.kos-reader-toolbar [aria-label="下一页"]').disabled`), 'rendered EPUB Reader');
    await waitFor(() => cdp.evaluate(`(() => {
      const container = document.querySelector('.kos-reader-adapter-host .epub-container');
      const overflowY = container ? getComputedStyle(container).overflowY : '';
      return Boolean(document.querySelector('.kos-reader-toolbar [aria-label="切换到分页阅读"]') && (overflowY === 'auto' || overflowY === 'scroll'));
    })()`), 'default scrollable EPUB layout');
    const layoutSwitchLocation = await cdp.evaluate(`document.querySelector('.kos-reader-document').dataset.readerLocation`);
    await cdp.evaluate(`document.querySelector('.kos-reader-toolbar [aria-label="切换到分页阅读"]').click()`);
    await waitFor(() => cdp.evaluate(`Boolean(document.querySelector('.kos-reader-toolbar [aria-label="切换到滚动阅读"]:not(:disabled)') && document.querySelector('.kos-reader-document').dataset.readerLocation === ${JSON.stringify(layoutSwitchLocation)})`), 'paginated EPUB layout at current CFI');
    await cdp.evaluate(`document.querySelector('.kos-reader-toolbar [aria-label="切换到滚动阅读"]').click()`);
    try {
      await waitFor(() => cdp.evaluate(`(() => {
        const container = document.querySelector('.kos-reader-adapter-host .epub-container');
        const overflowY = container ? getComputedStyle(container).overflowY : '';
        return Boolean(document.querySelector('.kos-reader-toolbar [aria-label="切换到分页阅读"]:not(:disabled)') && document.querySelector('.kos-reader-document').dataset.readerLocation === ${JSON.stringify(layoutSwitchLocation)} && (overflowY === 'auto' || overflowY === 'scroll'));
      })()`), 'restored scrollable EPUB layout at current CFI');
    } catch (error) {
      const layoutState = await cdp.evaluate(`(() => {
        const container = document.querySelector('.kos-reader-adapter-host .epub-container');
        return {
          expectedLocation: ${JSON.stringify(layoutSwitchLocation)},
          actualLocation: document.querySelector('.kos-reader-document')?.dataset.readerLocation,
          overflowY: container ? getComputedStyle(container).overflowY : '',
          scrollButton: Boolean(document.querySelector('.kos-reader-toolbar [aria-label="切换到分页阅读"]:not(:disabled)')),
          position: document.querySelector('.kos-reader-position')?.textContent,
        };
      })()`);
      throw new Error(`${error.message}; layoutState=${JSON.stringify(layoutState)}`);
    }
    let epubInitialLocation = await cdp.evaluate(`document.querySelector('.kos-reader-document').dataset.readerLocation`);
    await cdp.evaluate(`document.querySelector('.kos-reader-toolbar [aria-label="搜索"]').click()`);
    await waitFor(() => cdp.evaluate(`Boolean(document.querySelector('.kos-reader-search input'))`), 'EPUB search panel');
    await cdp.evaluate(`(() => {
      const input = document.querySelector('.kos-reader-search input');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, '第二页');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await waitFor(() => cdp.evaluate(`!document.querySelector('.kos-reader-search form > button').disabled`), 'enabled EPUB search');
    await cdp.evaluate(`document.querySelector('.kos-reader-search form').requestSubmit()`);
    await waitFor(() => cdp.evaluate(`document.querySelectorAll('.kos-reader-search-result').length > 0`), 'EPUB search results');
    await cdp.evaluate(`document.querySelector('.kos-reader-search-result').click()`);
    await waitFor(() => cdp.evaluate(`document.querySelector('.kos-reader-document').dataset.readerLocation !== ${JSON.stringify(epubInitialLocation)}`), 'EPUB search result jump');
    const epubSearchLocation = await cdp.evaluate(`document.querySelector('.kos-reader-document').dataset.readerLocation`);
    await cdp.evaluate(`document.querySelector('.kos-reader-panel [aria-label="关闭面板"]').click(); document.querySelector('.kos-reader-toolbar [aria-label="目录"]').click()`);
    await waitFor(() => cdp.evaluate(`Boolean(document.querySelector('.kos-reader-toc button'))`), 'EPUB table of contents after search');
    await cdp.evaluate(`document.querySelector('.kos-reader-toc button').click()`);
    await waitFor(() => cdp.evaluate(`document.querySelector('.kos-reader-document').dataset.readerLocation !== ${JSON.stringify(epubSearchLocation)}`), 'return to first EPUB chapter');
    epubInitialLocation = await cdp.evaluate(`document.querySelector('.kos-reader-document').dataset.readerLocation`);
    await cdp.evaluate(`document.querySelector('.kos-reader-panel [aria-label="关闭面板"]').click()`);
    const epubSelectionLabel = await cdp.evaluate(`document.querySelector('.kos-reader-position')?.textContent || 'EPUB 选区'`);
    await waitFor(() => cdp.evaluate(`[...document.querySelectorAll('.kos-reader-document[data-reader-kind="epub"] iframe')].some((frame) => frame.contentDocument?.body?.innerText?.trim())`), 'EPUB chapter content after search');
    const epubTextRect = await cdp.evaluate(`(() => {
      const iframe = [...document.querySelectorAll('.kos-reader-document[data-reader-kind="epub"] iframe')].find((frame) => frame.contentDocument?.body?.innerText?.trim());
      const frameDocument = iframe?.contentDocument;
      const target = [...(frameDocument?.querySelectorAll('p') || [])].find((element) => element.textContent?.trim()) || frameDocument?.body;
      if (!target?.textContent?.trim()) return null;
      const frameRect = iframe.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      return { x: frameRect.x + targetRect.x, y: frameRect.y + targetRect.y, width: targetRect.width, height: targetRect.height, text: target.textContent.trim() };
    })()`);
    if (!epubTextRect?.text || epubTextRect.width <= 4) throw new Error(`EPUB iframe did not expose selectable text: ${JSON.stringify(epubTextRect)}`);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: epubTextRect.x + 2, y: epubTextRect.y + epubTextRect.height / 2, button: 'left', buttons: 1, clickCount: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: epubTextRect.x + epubTextRect.width - 2, y: epubTextRect.y + epubTextRect.height / 2, button: 'left', buttons: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: epubTextRect.x + epubTextRect.width - 2, y: epubTextRect.y + epubTextRect.height / 2, button: 'left', buttons: 0, clickCount: 1 });
    const selectedEpubText = await waitFor(() => cdp.evaluate(`[...document.querySelectorAll('.kos-reader-document[data-reader-kind="epub"] iframe')].map((frame) => frame.contentWindow?.getSelection()?.toString()?.trim()).find(Boolean) || null`), 'EPUB text selection');
    await waitFor(() => cdp.evaluate(`(() => {
      const highlight = [...document.querySelectorAll('.kos-reader-selection-action')].find((el) => el.textContent.includes('划线'));
      const agent = [...document.querySelectorAll('.kos-reader-selection-action')].find((el) => el.textContent.includes('添加到 Agent'));
      const selectionBar = document.querySelector('.kos-reader-selection-bar');
      return Boolean(highlight && agent && !highlight.disabled && !agent.disabled && selectionBar?.textContent?.includes('批注'));
    })()`), 'enabled Reader selection actions');
    await screenshot(cdp, 'reader-selection-actions-desktop.png');
    await cdp.evaluate(`[...document.querySelectorAll('.kos-reader-selection-action')].find((el) => el.textContent.includes('划线')).click()`);
    await waitFor(() => exists(readerExtractPath), 'Reader Extract creation');
    await waitFor(async () => (await readFile(join(vault, '11_原材料', 'E2E输入01.md'), 'utf8')).includes('status: extracted'), 'Reader Source status update');
    const firstExtract = await readFile(readerExtractPath, 'utf8');
    if (!firstExtract.includes(`> ${selectedEpubText}`) || !firstExtract.includes(`- 位置：${epubSelectionLabel}`) || !firstExtract.includes('[[11_原材料/E2E示例.epub]]')) {
      throw new Error(`Reader Extract is incomplete: ${firstExtract.slice(0, 1000)}`);
    }
    await waitFor(() => cdp.evaluate(`Boolean(document.querySelector('[ref*="kos-reader-epub-highlight"]'))`), 'EPUB CFI highlight');
    await waitFor(() => cdp.evaluate(`![...document.querySelectorAll('.kos-reader-selection-action')].find((el) => el.textContent.includes('划线')).disabled`), 'Reader highlight completion');
    await cdp.evaluate(`[...document.querySelectorAll('.kos-reader-selection-action')].find((el) => el.textContent.includes('划线')).click()`);
    await waitFor(() => cdp.evaluate(`![...document.querySelectorAll('.kos-reader-selection-action')].find((el) => el.textContent.includes('划线')).disabled`), 'duplicate Reader highlight completion');
    const duplicateExtract = await readFile(readerExtractPath, 'utf8');
    if ((duplicateExtract.match(/<!-- kos-reader-extract:start /g) || []).length !== 1) {
      throw new Error('Duplicate Reader selection created another Extract block');
    }
    const userMessagesBeforeDraft = await cdp.evaluate(`document.querySelectorAll('.kos-agent-message-user').length`);
    await cdp.evaluate(`[...document.querySelectorAll('.kos-reader-selection-action')].find((el) => el.textContent.includes('添加到 Agent')).click()`);
    await waitFor(() => cdp.evaluate(`document.querySelector('.kos-agent-input')?.value?.includes(${JSON.stringify(selectedEpubText)}) && document.querySelector('.kos-agent-input')?.value?.includes('[[11_原材料/E2E输入01]]') && document.querySelector('.kos-agent-input')?.value?.includes(${JSON.stringify(epubSelectionLabel)})`), 'Reader selection Agent draft', 45_000);
    const userMessagesAfterDraft = await cdp.evaluate(`document.querySelectorAll('.kos-agent-message-user').length`);
    if (userMessagesAfterDraft !== userMessagesBeforeDraft) throw new Error('Reader selection was sent to Agent instead of only prefilling the draft');
    await screenshot(cdp, 'reader-selection-agent-draft-desktop.png');
    await waitFor(() => cdp.evaluate(`[...document.querySelectorAll('.kos-reader-document[data-reader-kind="epub"] iframe')].some((frame) => frame.contentDocument?.querySelector('h1, h2'))`), 'EPUB content after Agent draft');
    const epubHeadingRect = await cdp.evaluate(`(() => {
      const iframe = [...document.querySelectorAll('.kos-reader-document[data-reader-kind="epub"] iframe')].find((frame) => frame.contentDocument?.querySelector('h1, h2'));
      const frameDocument = iframe?.contentDocument;
      const target = frameDocument?.querySelector('h1, h2');
      if (!target?.textContent?.trim()) return null;
      const frameRect = iframe.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      return { x: frameRect.x + targetRect.x, y: frameRect.y + targetRect.y, width: targetRect.width, height: targetRect.height, text: target.textContent.trim() };
    })()`);
    if (!epubHeadingRect?.text || epubHeadingRect.width <= 4) throw new Error(`EPUB did not expose a second annotation selection: ${JSON.stringify(epubHeadingRect)}`);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: epubHeadingRect.x + 2, y: epubHeadingRect.y + epubHeadingRect.height / 2, button: 'left', buttons: 1, clickCount: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: epubHeadingRect.x + epubHeadingRect.width - 2, y: epubHeadingRect.y + epubHeadingRect.height / 2, button: 'left', buttons: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: epubHeadingRect.x + epubHeadingRect.width - 2, y: epubHeadingRect.y + epubHeadingRect.height / 2, button: 'left', buttons: 0, clickCount: 1 });
    const annotatedEpubText = await waitFor(() => cdp.evaluate(`[...document.querySelectorAll('.kos-reader-document[data-reader-kind="epub"] iframe')].map((frame) => frame.contentWindow?.getSelection()?.toString()?.trim()).find(Boolean) || null`), 'second EPUB text selection');
    if (!annotatedEpubText || annotatedEpubText === selectedEpubText) throw new Error('EPUB did not expose a second annotation selection');
    await waitFor(() => cdp.evaluate(`document.querySelector('.kos-reader-selection-count')?.textContent?.includes(${JSON.stringify(`已选择 ${annotatedEpubText.length} 字`)})`), 'second EPUB selection action');
    await waitFor(() => cdp.evaluate(`Boolean([...document.querySelectorAll('.kos-reader-selection-action')].find((el) => el.textContent.includes('批注')))`), 'EPUB annotation action');
    await cdp.evaluate(`[...document.querySelectorAll('.kos-reader-selection-action')].find((el) => el.textContent.includes('批注')).click()`);
    await waitFor(() => cdp.evaluate(`Boolean(document.querySelector('.kos-reader-annotation-composer input'))`), 'EPUB annotation composer');
    await cdp.evaluate(`(() => {
      const input = document.querySelector('.kos-reader-annotation-composer input');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, 'E2E 批注');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('.kos-reader-color-swatches [aria-label="blue"]').click();
    })()`);
    await waitFor(() => cdp.evaluate(`!document.querySelector('.kos-reader-annotation-save').disabled`), 'enabled annotation save');
    await cdp.evaluate(`document.querySelector('.kos-reader-annotation-save').click()`);
    await waitFor(async () => ((await readFile(readerExtractPath, 'utf8')).match(/<!-- kos-reader-extract:start /g) || []).length === 2, 'second Reader annotation');
    await cdp.evaluate(`document.querySelector('.kos-reader-toolbar [aria-label="阅读摘要"]').click()`);
    await waitFor(() => cdp.evaluate(`Boolean(document.querySelector('.kos-reader-summary-actions button'))`), 'Reader summary panel');
    const userMessagesBeforeSummary = await cdp.evaluate(`document.querySelectorAll('.kos-agent-message-user').length`);
    await cdp.evaluate(`[...document.querySelectorAll('.kos-reader-summary-actions button')].find((el) => el.textContent.includes('本次阅读')).click()`);
    await waitFor(() => cdp.evaluate(`document.querySelector('.kos-agent-input')?.value?.includes('/kos-summarize') && document.querySelector('.kos-agent-input')?.value?.includes('[[11_原材料/E2E输入01]]') && document.querySelector('.kos-agent-input')?.value?.includes('本次阅读会话') && document.querySelector('.kos-agent-input')?.value?.includes('E2E 批注')`), 'Reader session Summary Agent draft');
    const userMessagesAfterSummary = await cdp.evaluate(`document.querySelectorAll('.kos-agent-message-user').length`);
    if (userMessagesAfterSummary !== userMessagesBeforeSummary) throw new Error('Reader Summary was sent to Agent instead of only prefilling the draft');
    await cdp.evaluate(`document.querySelector('.kos-reader-toolbar [aria-label="划线与批注"]').click()`);
    await waitFor(() => cdp.evaluate(`document.querySelectorAll('.kos-reader-annotation').length === 2`), 'Reader annotation list');
    await cdp.evaluate(`[...document.querySelectorAll('.kos-reader-annotation [aria-label="删除批注"]')].at(-1).click()`);
    await waitFor(() => cdp.evaluate(`document.querySelectorAll('.kos-reader-annotation').length === 1`), 'Reader annotation deletion');
    const extractAfterDelete = await readFile(readerExtractPath, 'utf8');
    if ((extractAfterDelete.match(/<!-- kos-reader-extract:start /g) || []).length !== 1 || !extractAfterDelete.includes(selectedEpubText) || extractAfterDelete.includes('E2E 批注')) {
      throw new Error(`Reader annotation deletion removed the wrong block: ${extractAfterDelete.slice(0, 1200)}`);
    }
    await cdp.evaluate(`document.querySelector('.kos-reader-toolbar [aria-label="下一页"]').click()`);
    await waitFor(() => cdp.evaluate(`document.querySelector('.kos-reader-document').dataset.readerLocation && document.querySelector('.kos-reader-document').dataset.readerLocation !== ${JSON.stringify(epubInitialLocation)}`), 'EPUB next location');
    const epubNextLocation = await cdp.evaluate(`document.querySelector('.kos-reader-document').dataset.readerLocation`);
    await waitFor(() => cdp.evaluate(`app.plugins.plugins['kos-companion'].store.getReaderProgress('11_原材料/E2E输入01.md')?.location === ${JSON.stringify(epubNextLocation)}`), 'persisted EPUB progress');
    await screenshot(cdp, 'reader-epub-desktop.png');
    await cdp.evaluate(`document.querySelector('.kos-reader-header [aria-label="返回看板"]').click()`);
    await waitFor(() => cdp.evaluate(`app.workspace.activeLeaf?.view?.getViewType?.() === 'kos-dashboard'`), 'return after EPUB');
    await cdp.evaluate(`app.workspace.detachLeavesOfType('kos-reader')`);
    await waitFor(() => cdp.evaluate(`app.workspace.getLeavesOfType('kos-reader').length === 0`), 'closed Reader before restore');
    await cdp.evaluate(`[...document.querySelectorAll('#kos-board-input .kos-board-line')].find((el) => el.textContent.includes('E2E 输入 01')).querySelector('[aria-label="在 Reader 中阅读"]').click()`);
    await waitFor(() => cdp.evaluate(`document.querySelector('.kos-reader-document[data-reader-kind="epub"]')?.dataset.readerLocation === ${JSON.stringify(epubNextLocation)}`), 'restored EPUB progress');
    await cdp.evaluate(`document.querySelector('.kos-reader-toolbar [aria-label="划线与批注"]').click()`);
    await waitFor(() => cdp.evaluate(`document.querySelectorAll('.kos-reader-annotation').length === 1`), 'restored EPUB annotation list');
    await cdp.evaluate(`document.querySelector('.kos-reader-annotation-main').click()`);
    try {
      await waitFor(() => cdp.evaluate(`Boolean(document.querySelector('[ref*="kos-reader-epub-highlight"]'))`), 'restored EPUB CFI highlight');
    } catch (error) {
      const restoredHighlightState = await cdp.evaluate(`({
        location: document.querySelector('.kos-reader-document')?.dataset.readerLocation,
        error: document.querySelector('.kos-reader-action-error')?.textContent,
        svgs: [...document.querySelectorAll('.epub-view svg')].map((svg) => svg.outerHTML.slice(0, 1000)),
        frames: [...document.querySelectorAll('.kos-reader-document[data-reader-kind="epub"] iframe')].map((frame) => frame.contentDocument?.body?.innerText),
      })`);
      throw new Error(`${error.message}; restoredHighlightState=${JSON.stringify(restoredHighlightState)}`);
    }
    await cdp.evaluate(`document.querySelector('.kos-reader-header [aria-label="返回看板"]').click()`);
    await waitFor(() => cdp.evaluate(`app.workspace.activeLeaf?.view?.getViewType?.() === 'kos-dashboard'`), 'return to dashboard after Reader restore');

    await cdp.evaluate(`app.workspace.detachLeavesOfType('kos-reader')`);
    await cdp.evaluate(`app.workspace.getLeaf('tab').openFile(app.vault.getFileByPath('11_原材料/E2E示例.epub'))`);
    await waitFor(() => cdp.evaluate(`app.workspace.activeLeaf?.view?.getViewType?.() === 'kos-reader' && Boolean(document.querySelector('.kos-reader-document[data-reader-kind="epub"] iframe'))`), 'direct open of associated EPUB');
    const duplicateSource = await cdp.evaluate(`Boolean(app.vault.getFileByPath('11_原材料/E2E示例.md'))`);
    if (duplicateSource) throw new Error('Direct EPUB open created a duplicate Source');
    await cdp.evaluate(`document.querySelector('.kos-reader-header [aria-label="返回看板"]').click()`);
    await waitFor(() => cdp.evaluate(`app.workspace.activeLeaf?.view?.getViewType?.() === 'kos-dashboard'`), 'return after associated EPUB open');
    await cdp.evaluate(`app.workspace.detachLeavesOfType('kos-reader')`);
    await waitFor(() => cdp.evaluate(`app.workspace.getLeavesOfType('kos-reader').length === 0`), 'closed Reader before direct EPUB open');
    await cdp.evaluate(`app.workspace.getLeaf('tab').openFile(app.vault.getFileByPath('11_原材料/E2E直接打开.epub'))`);
    await waitFor(() => cdp.evaluate(`app.workspace.activeLeaf?.view?.getViewType?.() === 'kos-reader' && Boolean(document.querySelector('.kos-reader-document[data-reader-kind="epub"] iframe'))`), 'direct EPUB file open');
    await waitFor(() => cdp.evaluate(`Boolean(app.vault.getFileByPath('11_原材料/E2E直接打开.md'))`), 'automatic Source creation');
    const directSource = await cdp.evaluate(`app.vault.cachedRead(app.vault.getFileByPath('11_原材料/E2E直接打开.md'))`);
    if (!directSource.includes('type: source') || !directSource.includes('source_location: "[[11_原材料/E2E直接打开.epub]]"')) {
      throw new Error(`Automatic Source is invalid: ${directSource.slice(0, 500)}`);
    }
    await cdp.evaluate(`document.querySelector('.nav-folder-title[data-path="11_原材料"]')?.click()`);
    await waitFor(() => cdp.evaluate(`Boolean(document.querySelector('.nav-file-title[data-path="11_原材料/E2E直接打开.epub"]'))`), 'EPUB visible in file explorer');
    await screenshot(cdp, 'reader-epub-direct-open-desktop.png');
    await cdp.evaluate(`document.querySelector('.kos-reader-header [aria-label="返回看板"]').click()`);
    await waitFor(() => cdp.evaluate(`app.workspace.activeLeaf?.view?.getViewType?.() === 'kos-dashboard'`), 'return after direct EPUB open');

    await cdp.evaluate(`app.commands.executeCommandById('kos-companion:open-system')`);
    await waitFor(() => cdp.evaluate(`app.workspace.activeLeaf?.view?.getViewType?.() === 'kos-dashboard' && document.querySelector('#kos-board-system')?.getClientRects().length > 0 && document.querySelector('#kos-board-system').getBoundingClientRect().top < 180`), 'visible system section focus');
    const agentMarkdownFixture = '# Markdown E2E\n\n- rendered list\n\n| Key | Value |\n| --- | --- |\n| mode | markdown |\n\n```ts\nconst rendered = true;\n```';
    const agentThinkingFixture = '**Execution E2E**\n\n- reasoning step';
    await cdp.evaluate(`(() => {
      const view = app.workspace.getLeavesOfType('kos-agent')[0]?.view;
      if (!view) return false;
      view.renderStoredMessage({
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: ${JSON.stringify(agentThinkingFixture)} },
          { type: 'text', text: ${JSON.stringify(agentMarkdownFixture)} }
        ]
      });
      return true;
    })()`);
    await waitFor(() => cdp.evaluate(`(() => {
      const message = [...document.querySelectorAll('.kos-agent-message-assistant')].at(-1);
      const thinking = message?.querySelector('.kos-agent-thinking');
      const body = message?.querySelector('.kos-agent-message-body');
      return Boolean(thinking?.classList.contains('markdown-rendered')
        && thinking.querySelector('strong')?.textContent === 'Execution E2E'
        && thinking.querySelector('li')?.textContent === 'reasoning step'
        && body?.classList.contains('markdown-rendered')
        && body.querySelector('h1')?.textContent === 'Markdown E2E'
        && body.querySelector('li')?.textContent === 'rendered list'
        && body.querySelector('table')?.textContent?.includes('markdown')
        && body.querySelector('pre code')?.textContent?.includes('const rendered = true;'));
    })()`), 'Agent thinking and assistant Markdown rendering');
    await cdp.evaluate(`[...document.querySelectorAll('.kos-board-button')].find((el) => el.textContent.includes('刷新状态')).click()`);
    await waitFor(() => cdp.evaluate(`document.querySelector('#kos-board-system')?.textContent?.includes('在线')`), 'Agent online state', 45_000);
    try {
      await waitFor(() => cdp.evaluate(`document.querySelector('#kos-board-system')?.getClientRects().length > 0 && document.querySelector('#kos-board-system').getBoundingClientRect().top < 180`), 'visible system section after refresh');
    } catch (error) {
      const scrollDiagnostics = await cdp.evaluate(`(() => {
        const section = document.querySelector('#kos-board-system');
        const dashboard = document.querySelector('.kos-dashboard-v2');
        const ancestors = [];
        for (let el = section; el; el = el.parentElement) {
          ancestors.push({ className: el.className, scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, overflowY: getComputedStyle(el).overflowY });
        }
        return { activeView: app.workspace.activeLeaf?.view?.getViewType?.(), sectionTop: section?.getBoundingClientRect().top, visible: section?.getClientRects().length, dashboardScrollTop: dashboard?.scrollTop, ancestors };
      })()`);
      throw new Error(`${error.message}; diagnostics=${JSON.stringify(scrollDiagnostics)}`);
    }
    await screenshot(cdp, 'dashboard-system-desktop.png');

    await cdp.evaluate(`app.commands.executeCommandById('kos-companion:open-action')`);
    await waitFor(() => cdp.evaluate(`app.workspace.activeLeaf?.view?.getViewType?.() === 'kos-dashboard' && document.querySelector('#kos-board-action')?.getClientRects().length > 0 && document.querySelector('#kos-board-action').getBoundingClientRect().top < 180`), 'visible action section focus');
    await waitFor(() => cdp.evaluate(`Boolean([...document.querySelectorAll('.kos-board-link')].find((el) => el.textContent.includes('E2E 推进插件二期')))`), 'seed task row');
    await screenshot(cdp, 'dashboard-action-desktop.png');
    await cdp.evaluate(`document.querySelector('#kos-action-tasks')?.scrollIntoView({ block: 'start' })`);
    await cdp.evaluate(`[...document.querySelectorAll('#kos-action-tasks .kos-board-tabs button')].find((button) => button.textContent === '进行中')?.click()`);
    await waitFor(() => cdp.evaluate(`Boolean(document.querySelector('#kos-action-tasks + .kos-board-lines .kos-board-check:not(:disabled)'))`), 'doing task filter');
    await cdp.evaluate(`document.querySelector('#kos-action-tasks + .kos-board-lines .kos-board-check:not(:disabled)').click()`);
    await waitFor(() => cdp.evaluate(`Boolean([...document.querySelectorAll('.modal-container button')].find((button) => button.textContent === '确认完成'))`), 'complete task dialog');
    await cdp.evaluate(`(() => {
      const modal = [...document.querySelectorAll('.modal-container')].find((element) => element.textContent.includes('确认完成'));
      const setValue = (element, value) => {
        if (!element) return;
        element.value = value;
        element.dispatchEvent(new Event('input', { bubbles: true }));
      };
      setValue(modal?.querySelector('textarea'), 'E2E 完成任务');
      for (const input of modal?.querySelectorAll('input[placeholder="贡献证据"]') ?? []) setValue(input, 'E2E 验收通过');
    })()`);
    await waitFor(() => cdp.evaluate(`(() => {
      const modal = [...document.querySelectorAll('.modal-container')].find((element) => element.textContent.includes('确认完成'));
      return modal?.querySelector('textarea')?.value === 'E2E 完成任务'
        && [...(modal?.querySelectorAll('input[placeholder="贡献证据"]') ?? [])].every((input) => input.value === 'E2E 验收通过');
    })()`), 'complete task form values');
    const completionClicked = await cdp.evaluate(`(() => {
      const modal = [...document.querySelectorAll('.modal-container')].find((element) => element.textContent.includes('确认完成'));
      const button = [...(modal?.querySelectorAll('button') ?? [])].find((item) => item.textContent === '确认完成');
      if (!button) return false;
      button.click();
      return true;
    })()`);
    if (!completionClicked) throw new Error('Complete task submit button was not clicked');
    try {
      await waitFor(async () => (await readFile(taskPath, 'utf8')).includes('status: done'), 'Agent task transition', 30_000);
    } catch (error) {
      const completionState = await cdp.evaluate(`({
        notices: [...document.querySelectorAll('.notice')].map((item) => item.textContent),
        modal: [...document.querySelectorAll('.modal-container')].map((item) => item.textContent).find((text) => text.includes('确认完成')),
        agentRunning: app.plugins.plugins['kos-companion'].agentClient?.isRunning,
        pendingCommands: [...(app.plugins.plugins['kos-companion'].agentClient?.pending?.keys?.() ?? [])],
      })`);
      throw new Error(`${error.message}; completionState=${JSON.stringify(completionState)}`);
    }

    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await cdp.evaluate(`(async () => {
      await app.workspace.leftSplit.collapse();
      await app.workspace.rightSplit.collapse();
    })()`);
    await waitFor(() => cdp.evaluate(`Boolean(app.workspace.leftSplit.collapsed && app.workspace.rightSplit.collapsed)`), 'sidebars to collapse');
    await waitFor(() => cdp.evaluate(`document.querySelectorAll('.notice').length === 0`), 'transition notice to close', 15_000);
    await cdp.evaluate(`app.commands.executeCommandById('kos-companion:open-dashboard')`);
    await waitFor(() => cdp.evaluate(`document.querySelector('.kos-dot-clock').getBoundingClientRect().top < 100`), 'mobile clock entry');
    await waitFor(() => cdp.evaluate(`document.querySelector('.kos-board-grid')?.dataset.bentoFitted === 'true'`), 'mobile fitted Bento rows');
    const mobileBento = await cdp.evaluate(`(() => {
      const sections = [...document.querySelectorAll('.kos-board-section')].map((element) => element.getBoundingClientRect());
      return {
        columns: getComputedStyle(document.querySelector('.kos-board-grid')).gridTemplateColumns.split(' ').length,
        ordered: sections.every((rect, index) => index === 0 || rect.top > sections[index - 1].top),
      };
    })()`);
    if (mobileBento.columns !== 1 || !mobileBento.ordered) {
      throw new Error(`Mobile dashboard did not collapse to one column: ${JSON.stringify(mobileBento)}`);
    }
    const mobileOverflow = await cdp.evaluate(`document.documentElement.scrollWidth > window.innerWidth + 1`);
    if (mobileOverflow) throw new Error('Mobile dashboard has horizontal overflow');
    await screenshot(cdp, 'dashboard-today-mobile.png');

    await cdp.evaluate(`app.commands.executeCommandById('kos-companion:open-input')`);
    await waitFor(() => cdp.evaluate(`document.querySelector('#kos-board-input')?.getBoundingClientRect().top < 100`), 'mobile input section');
    await cdp.evaluate(`app.workspace.detachLeavesOfType('kos-reader')`);
    await waitFor(() => cdp.evaluate(`app.workspace.getLeavesOfType('kos-reader').length === 0`), 'closed Reader before mobile open');
    await cdp.evaluate(`[...document.querySelectorAll('#kos-board-input .kos-board-line')].find((el) => el.textContent.includes('E2E 输入 01')).querySelector('[aria-label="在 Reader 中阅读"]').click()`);
    await waitFor(() => cdp.evaluate(`app.workspace.activeLeaf?.view?.getViewType?.() === 'kos-reader' && Boolean(document.querySelector('.kos-reader-document[data-reader-kind="epub"] iframe')) && Boolean(document.querySelector('.kos-reader-document').dataset.readerLocation)`), 'mobile EPUB Reader');
    const mobileReaderOverflow = await cdp.evaluate(`(() => {
      const dimensions = (selector) => {
        const element = document.querySelector(selector);
        return element ? { selector, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, rect: element.getBoundingClientRect().toJSON() } : null;
      };
      const shell = document.querySelector('.kos-reader-shell');
      return {
        overflow: !shell || shell.scrollWidth > shell.clientWidth + 1 || document.documentElement.scrollWidth > window.innerWidth + 1,
        viewport: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        elements: [
          '.kos-reader-shell', '.kos-reader-header', '.kos-reader-toolbar', '.kos-reader-workspace',
          '.kos-reader-document', '.kos-reader-adapter-host', '.epub-container', '.epub-view', '.epub-view iframe',
        ].map(dimensions),
      };
    })()`);
    if (mobileReaderOverflow.overflow) throw new Error(`Mobile Reader has horizontal overflow: ${JSON.stringify(mobileReaderOverflow)}`);
    await screenshot(cdp, 'reader-epub-mobile.png');

    const result = { root, vault, artifacts, initial, wideBento, resizeHover, mobileBento, agentConnected: true, taskTransition: 'doing -> done' };
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    cdp?.close();
    child.kill('SIGTERM');
    await Promise.race([
      new Promise((resolveExit) => child.once('exit', resolveExit)),
      new Promise((resolveExit) => setTimeout(resolveExit, 3000)),
    ]);
    if (child.exitCode === null) child.kill('SIGKILL');
    if (stderr && child.exitCode && child.exitCode !== 0) process.stderr.write(stderr.slice(-4000));
  }
}

await run();
