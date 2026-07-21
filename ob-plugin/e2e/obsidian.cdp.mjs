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
const taskPath = join(vault, '31_任务', 'E2E推进插件二期.md');
const readerExtractPath = join(vault, '20_处理区', '摘录', 'E2E 输入 01_摘录.md');
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
  await mkdir(join(vault, '31_任务'), { recursive: true });
  await mkdir(join(vault, '30_项目'), { recursive: true });
  await mkdir(join(vault, '11_原材料'), { recursive: true });
  await mkdir(join(vault, '22_知识库'), { recursive: true });
  await mkdir(profile, { recursive: true });
  await mkdir(artifacts, { recursive: true });
  for (const file of ['main.js', 'manifest.json', 'styles.css']) await cp(join(pluginRoot, file), join(pluginDir, file));
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
  await writeFile(join(vault, '30_项目', '插件二期.md'), `---\ntype: project\ntitle: 插件二期\nstatus: active\npriority: P0\ngoal: 完成统一看板与 Agent 集成\ncurrent_stage: E2E\ndue: ${today()}\ncreated: ${today()}\nupdated: ${today()}\ntags: [kos-e2e]\n---\n`);
  await writeFile(taskPath, `---\ntype: task\ntitle: E2E 推进插件二期\nstatus: doing\nproject: "[[30_项目/插件二期]]"\npriority: P0\ndue: ${today()}\ncompleted:\ncreated: ${today()}\ntags: [kos-e2e]\n---\n`);
  await writeFile(join(vault, '11_原材料', 'E2E示例.pdf'), Buffer.from(pdfFixture, 'base64'));
  await writeFile(join(vault, '11_原材料', 'E2E示例.epub'), Buffer.from(epubFixture, 'base64'));
  await writeFile(join(vault, '11_原材料', 'E2E直接打开.epub'), Buffer.from(epubFixture, 'base64'));
  for (let index = 1; index <= 12; index += 1) {
    const suffix = String(index).padStart(2, '0');
    const location = index === 2
      ? 'source_location: "[[11_原材料/E2E示例.pdf]]"\n'
      : index === 1
        ? 'source_location: "[[11_原材料/E2E示例.epub]]"\n'
        : '';
    await writeFile(join(vault, '11_原材料', `E2E输入${suffix}.md`), `---\ntype: source\ntitle: E2E 输入 ${suffix}\nstatus: captured\nformat: article\nimportance: high\n${location}created: 2026-07-${suffix}\ntags: [kos-e2e]\n---\n`);
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
    await cdp.evaluate(`localStorage.setItem('enable-plugin-e2e', 'true')`);
    const pluginLoad = await cdp.evaluate(`(async () => {
      try {
        if (app.plugins.plugins?.['kos-companion']) return { loaded: true };
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
      sectionsOrdered: (() => {
        const sections = [...document.querySelectorAll('.kos-board-section')].map((el) => el.offsetTop);
        return sections.length === 6 && sections.every((top, index) => index === 0 || top > sections[index - 1]);
      })(),
    }))()`);
    if (initial.sections.length !== 6) throw new Error(`Expected 6 simultaneous sections, got ${initial.sections.length}`);
    if (initial.switchNavigation !== 0) throw new Error('Dashboard still contains module-switch navigation');
    if (initial.startButtons !== 1) throw new Error('Manual 开始一天 control is missing');
    if (initial.agentLeaves !== 0) throw new Error('Dashboard open unexpectedly activated Agent');
    if (initial.overflow) throw new Error('Desktop dashboard has horizontal overflow');
    if (!initial.sectionsOrdered) throw new Error('Dashboard sections are not in one continuous vertical page');
    await screenshot(cdp, 'dashboard-today-desktop.png');

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
    if (inputFirstPage.rows !== 10 || !inputFirstPage.label?.includes('1–10 / 12')) {
      throw new Error(`Input first page is not capped at 10: ${JSON.stringify(inputFirstPage)}`);
    }
    await cdp.evaluate(`document.querySelector('#kos-board-input .kos-board-page-button[aria-label="下一页"]').click()`);
    await waitFor(() => cdp.evaluate(`document.querySelectorAll('#kos-board-input .kos-board-lines .kos-board-line').length === 2 && document.querySelector('#kos-board-input .kos-board-pagination-label')?.textContent?.includes('11–12 / 12')`), 'input second page');
    await screenshot(cdp, 'dashboard-input-page-2-desktop.png');
    await cdp.evaluate(`document.querySelector('#kos-board-knowledge').scrollIntoView({ block: 'start' })`);
    await screenshot(cdp, 'dashboard-knowledge-desktop.png');
    await cdp.evaluate(`document.querySelector('#kos-board-review').scrollIntoView({ block: 'start' })`);
    await screenshot(cdp, 'dashboard-review-desktop.png');
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
    await waitFor(() => cdp.evaluate(`(() => {
      const container = document.querySelector('.kos-reader-adapter-host .epub-container');
      const overflowY = container ? getComputedStyle(container).overflowY : '';
      return Boolean(document.querySelector('.kos-reader-toolbar [aria-label="切换到分页阅读"]:not(:disabled)') && document.querySelector('.kos-reader-document').dataset.readerLocation === ${JSON.stringify(layoutSwitchLocation)} && (overflowY === 'auto' || overflowY === 'scroll'));
    })()`), 'restored scrollable EPUB layout at current CFI');
    const epubInitialLocation = await cdp.evaluate(`document.querySelector('.kos-reader-document').dataset.readerLocation`);
    const epubSelectionLabel = await cdp.evaluate(`document.querySelector('.kos-reader-position')?.textContent || 'EPUB 选区'`);
    const selectedEpubText = await cdp.evaluate(`(() => {
      const iframe = document.querySelector('.kos-reader-document[data-reader-kind="epub"] iframe');
      const frameDocument = iframe?.contentDocument;
      const target = [...(frameDocument?.querySelectorAll('p') || [])].find((element) => element.textContent?.trim()) || frameDocument?.body;
      if (!target?.textContent?.trim()) return '';
      const range = frameDocument.createRange();
      range.selectNodeContents(target);
      const selection = iframe.contentWindow.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      frameDocument.dispatchEvent(new iframe.contentWindow.Event('selectionchange'));
      return selection.toString().trim();
    })()`);
    if (!selectedEpubText) throw new Error('EPUB iframe did not expose selectable text');
    await waitFor(() => cdp.evaluate(`(() => {
      const extract = document.querySelector('.kos-reader-toolbar [aria-label="添加到摘录"]');
      const agent = document.querySelector('.kos-reader-toolbar [aria-label="添加到 Agent"]');
      const selectionBar = document.querySelector('.kos-reader-selection-bar');
      return Boolean(extract && agent && !extract.disabled && !agent.disabled && selectionBar?.textContent?.includes('添加到摘录') && selectionBar.textContent.includes('添加到 Agent'));
    })()`), 'enabled Reader selection actions');
    await screenshot(cdp, 'reader-selection-actions-desktop.png');
    await cdp.evaluate(`document.querySelector('.kos-reader-toolbar [aria-label="添加到摘录"]').click()`);
    await waitFor(() => exists(readerExtractPath), 'Reader Extract creation');
    await waitFor(async () => (await readFile(join(vault, '11_原材料', 'E2E输入01.md'), 'utf8')).includes('status: extracted'), 'Reader Source status update');
    const firstExtract = await readFile(readerExtractPath, 'utf8');
    if (!firstExtract.includes(`> ${selectedEpubText}`) || !firstExtract.includes(`- 位置：${epubSelectionLabel}`) || !firstExtract.includes('[[11_原材料/E2E示例.epub]]')) {
      throw new Error(`Reader Extract is incomplete: ${firstExtract.slice(0, 1000)}`);
    }
    await waitFor(() => cdp.evaluate(`!document.querySelector('.kos-reader-toolbar [aria-label="添加到摘录"]').disabled`), 'Reader Extract action completion');
    await cdp.evaluate(`document.querySelector('.kos-reader-toolbar [aria-label="添加到摘录"]').click()`);
    await waitFor(() => cdp.evaluate(`!document.querySelector('.kos-reader-toolbar [aria-label="添加到摘录"]').disabled`), 'duplicate Reader Extract action completion');
    const duplicateExtract = await readFile(readerExtractPath, 'utf8');
    if ((duplicateExtract.match(/<!-- kos-reader-extract:start /g) || []).length !== 1) {
      throw new Error('Duplicate Reader selection created another Extract block');
    }
    const userMessagesBeforeDraft = await cdp.evaluate(`document.querySelectorAll('.kos-agent-message-user').length`);
    await cdp.evaluate(`document.querySelector('.kos-reader-toolbar [aria-label="添加到 Agent"]').click()`);
    await waitFor(() => cdp.evaluate(`document.querySelector('.kos-agent-input')?.value?.includes(${JSON.stringify(selectedEpubText)}) && document.querySelector('.kos-agent-input')?.value?.includes('[[11_原材料/E2E输入01]]') && document.querySelector('.kos-agent-input')?.value?.includes(${JSON.stringify(epubSelectionLabel)})`), 'Reader selection Agent draft', 45_000);
    const userMessagesAfterDraft = await cdp.evaluate(`document.querySelectorAll('.kos-agent-message-user').length`);
    if (userMessagesAfterDraft !== userMessagesBeforeDraft) throw new Error('Reader selection was sent to Agent instead of only prefilling the draft');
    await screenshot(cdp, 'reader-selection-agent-draft-desktop.png');
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
    await cdp.evaluate(`document.querySelector('#kos-action-tasks + .kos-board-lines .kos-board-check:not(:disabled)').click()`);
    await waitFor(async () => (await readFile(taskPath, 'utf8')).includes('status: done'), 'Agent task transition', 30_000);

    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await cdp.evaluate(`(async () => {
      await app.workspace.leftSplit.collapse();
      await app.workspace.rightSplit.collapse();
    })()`);
    await waitFor(() => cdp.evaluate(`Boolean(app.workspace.leftSplit.collapsed && app.workspace.rightSplit.collapsed)`), 'sidebars to collapse');
    await waitFor(() => cdp.evaluate(`document.querySelectorAll('.notice').length === 0`), 'transition notice to close', 15_000);
    await cdp.evaluate(`app.commands.executeCommandById('kos-companion:open-dashboard')`);
    await waitFor(() => cdp.evaluate(`document.querySelector('#kos-board-today').getBoundingClientRect().top < 100`), 'mobile today section');
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

    const result = { root, vault, artifacts, initial, agentConnected: true, taskTransition: 'doing -> done' };
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
