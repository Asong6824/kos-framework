#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const requireFromPlugin = createRequire(new URL('../../ob-plugin/package.json', import.meta.url));
const {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  S3Client,
} = requireFromPlugin('@aws-sdk/client-s3');

const obsidianBin = '/Applications/Obsidian.app/Contents/MacOS/Obsidian';
const requiredEnvironment = [
  'KOS_R2_ACCOUNT_ID',
  'KOS_R2_BUCKET',
  'KOS_R2_ACCESS_KEY_ID',
  'KOS_R2_SECRET_ACCESS_KEY',
  'KOS_NEW_USER_VAULT_A',
  'KOS_NEW_USER_VAULT_B',
];

function fail(message) {
  console.error(`新用户同步验收失败：${message}`);
  process.exit(1);
}

async function exists(path) {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function waitFor(operation, label, timeout = 60_000) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeout) {
    try {
      const value = await operation();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 300));
  }
  throw new Error(`等待${label}超时${lastError instanceof Error ? `：${lastError.message}` : ''}`);
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
        if (
          message.method === 'Runtime.exceptionThrown'
          || message.method === 'Log.entryAdded'
          || message.method === 'Runtime.consoleAPICalled'
        ) {
          this.events.push(message);
        }
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
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    }
    return result.result.value;
  }

  close() {
    this.socket.close();
  }
}

async function prepareVault(vault) {
  for (const required of [
    '.kos.md',
    '.obsidian/plugins/kos-companion/manifest.json',
    '.obsidian/plugins/kos-companion/main.js',
  ]) {
    if (!(await exists(join(vault, required)))) {
      throw new Error(`${vault} 不是已安装 kos Companion 的 kos Vault：缺少 ${required}`);
    }
  }
  await writeFile(
    join(vault, '.obsidian', 'community-plugins.json'),
    '[]\n',
  );
  const inbox = join(vault, '10_收件箱');
  for (const name of await readdir(inbox)) {
    if (/^新用户同步验收-\d+\.md$/.test(name)) {
      await rm(join(inbox, name), { force: true });
    }
  }
}

export async function launchObsidian(vault, profile, port) {
  await mkdir(profile, { recursive: true });
  const agentConfig = join(profile, 'agent-config');
  await mkdir(agentConfig, { recursive: true });
  await writeFile(
    join(profile, 'obsidian.json'),
    `${JSON.stringify({
      vaults: {
        newUser: {
          path: vault,
          ts: Date.now(),
          open: true,
        },
      },
    }, null, 2)}\n`,
  );
  const child = spawn(obsidianBin, [
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${port}`,
    '--disable-gpu',
    '--window-size=1280,900',
  ], {
    stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, KOS_AGENT_DIR: agentConfig },
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += String(chunk);
  });
  const target = await waitFor(async () => {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (!response.ok) return null;
      const pages = await response.json();
      return pages.find((page) => page.type === 'page' && page.webSocketDebuggerUrl);
    } catch {
      return null;
    }
  }, ` Obsidian 调试端口 ${port}`, 45_000);
  const cdp = new Cdp(target.webSocketDebuggerUrl);
  await cdp.open();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.evaluate(`localStorage.setItem('enable-plugin-e2e', 'true')`);
  await cdp.send('Page.reload', { ignoreCache: true });
  await new Promise((resolveReload) => setTimeout(resolveReload, 1_500));
  await waitFor(
    () => cdp.evaluate('Boolean(globalThis.app?.workspace?.layoutReady)'),
    ' Obsidian 工作区',
    45_000,
  );
  await waitFor(
    () => cdp.evaluate(`Boolean(
      app.metadataCache.getFileCache(
        app.vault.getFileByPath('90_系统/模板/Task_任务模板.md')
      )?.frontmatter
    )`),
    ' Vault 元数据索引',
    45_000,
  );
  const pluginState = await cdp.evaluate(`(async () => {
    let error = '';
    let loadResult = null;
    try {
      localStorage.setItem('enable-plugin-e2e', 'true');
      await app.plugins.loadManifests();
      if (typeof app.plugins.loadPlugin === 'function') {
        loadResult = await app.plugins.loadPlugin('kos-companion');
      }
      if (!app.plugins.plugins?.['kos-companion']) {
        if (typeof app.plugins.setEnable === 'function') {
          await app.plugins.setEnable('kos-companion', false);
          await app.plugins.setEnable('kos-companion', true);
        } else if (typeof app.plugins.disablePluginAndSave === 'function') {
          await app.plugins.disablePluginAndSave('kos-companion');
        } else {
          await app.plugins.disablePlugin('kos-companion');
        }
      }
      if (!app.plugins.plugins?.['kos-companion'] && typeof app.plugins.enablePluginAndSave === 'function') {
        await app.plugins.enablePluginAndSave('kos-companion');
      } else if (!app.plugins.plugins?.['kos-companion']) {
        await app.plugins.enablePlugin('kos-companion');
      }
    } catch (caught) {
      error = caught instanceof Error ? caught.stack || caught.message : String(caught);
    }
    return {
      vaultPath: app.vault.adapter?.basePath || '',
      manifestPresent: Boolean(app.plugins.manifests?.['kos-companion']),
      enabled: app.plugins.enabledPlugins?.has?.('kos-companion') ?? false,
      loaded: Boolean(app.plugins.plugins?.['kos-companion']),
      loadResult,
      managerMethods: Object.getOwnPropertyNames(Object.getPrototypeOf(app.plugins)),
      managerKeys: Object.keys(app.plugins),
      error,
    };
  })()`);
  if (!pluginState.loaded) {
    try {
      await waitFor(() => cdp.evaluate(`(async () => {
        if (app.plugins.plugins?.['kos-companion']) return true;
        if (typeof app.plugins.enablePluginAndSave === 'function') {
          await app.plugins.enablePluginAndSave('kos-companion');
        } else {
          await app.plugins.loadPlugin('kos-companion');
        }
        return Boolean(app.plugins.plugins?.['kos-companion']);
      })()`), ' kos Companion 加载', 60_000);
    } catch {
      const manualModule = await cdp.evaluate(`(() => {
        try {
          const fullPath = app.vault.adapter.getFullPath('.obsidian/plugins/kos-companion/main.js');
          const loaded = require(fullPath);
          return {
            type: typeof loaded,
            defaultType: typeof loaded?.default,
            name: loaded?.name || loaded?.default?.name || '',
          };
        } catch (error) {
          return { error: error instanceof Error ? error.stack || error.message : String(error) };
        }
      })()`);
      child.kill('SIGTERM');
      throw new Error(`kos Companion 未能加载：${JSON.stringify(pluginState)}；module=${JSON.stringify(manualModule)}；events=${JSON.stringify(cdp.events.slice(-10))}${stderr ? `；${stderr.slice(-500)}` : ''}`);
    }
  }
  return { child, cdp };
}

async function configureFirstDevice(cdp, sync) {
  const result = await cdp.evaluate(`(async () => {
    const plugin = app.plugins.plugins['kos-companion'];
    const candidate = {
      enabled: false,
      paused: false,
      accountId: ${JSON.stringify(sync.accountId)},
      bucket: ${JSON.stringify(sync.bucket)},
      accessKeyId: ${JSON.stringify(sync.accessKeyId)},
      secretAccessKey: ${JSON.stringify(sync.secretAccessKey)},
      vaultId: '',
    };
    const preflight = await plugin.testSyncConfiguration(candidate, true);
    plugin.settings.sync.enabled = true;
    await plugin.saveSettings();
    await plugin.reloadSync();
    return {
      vaultId: plugin.settings.sync.vaultId,
      snapshot: plugin.sync.getSnapshot(),
      preflight: preflight.result,
    };
  })()`);
  if (result.snapshot.phase !== 'up-to-date') {
    throw new Error(`首台设备未进入已同步状态：${result.snapshot.phase} / ${result.snapshot.message}`);
  }
  return result.vaultId;
}

function createJoinCode(sync, vaultId) {
  const payload = Buffer.from(JSON.stringify({
    version: 1,
    accountId: sync.accountId,
    bucket: sync.bucket,
    accessKeyId: sync.accessKeyId,
    secretAccessKey: sync.secretAccessKey,
    vaultId,
  }), 'utf8').toString('base64url');
  return `KOS-SYNC1.${payload}`;
}

async function joinSecondDeviceThroughUi(cdp, joinCode) {
  await cdp.evaluate(`(() => {
    app.setting.open();
    app.setting.openTabById('kos-companion');
    const button = [...document.querySelectorAll('.setting-item button')]
      .find((item) => item.textContent === '从剪贴板加入');
    if (!button) throw new Error('设置页中没有“从剪贴板加入”');
    button.click();
  })()`);
  await waitFor(
    () => cdp.evaluate(`Boolean(document.querySelector('textarea[aria-label="kos-sync 设备加入码"]'))`),
    '设备加入码输入框',
  );
  await cdp.evaluate(`(() => {
    const input = document.querySelector('textarea[aria-label="kos-sync 设备加入码"]');
    input.value = ${JSON.stringify(joinCode)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const modal = input.closest('.modal-container');
    const button = [...modal.querySelectorAll('button')]
      .find((item) => item.textContent === '加入并开始同步');
    button.click();
  })()`);
  return waitFor(async () => {
    const snapshot = await cdp.evaluate(`(() => {
      const plugin = app.plugins.plugins['kos-companion'];
      return {
        enabled: plugin.settings.sync.enabled,
        snapshot: plugin.sync.getSnapshot(),
      };
    })()`);
    if (snapshot.snapshot.phase === 'error') {
      throw new Error(snapshot.snapshot.message);
    }
    return snapshot.enabled && snapshot.snapshot.phase === 'up-to-date' ? snapshot.snapshot : null;
  }, '第二台设备完成首次同步', 90_000);
}

async function syncNow(cdp) {
  return cdp.evaluate(`(async () => {
    const plugin = app.plugins.plugins['kos-companion'];
    await plugin.sync.syncNow();
    return plugin.sync.getSnapshot();
  })()`);
}

async function syncNowThroughDashboard(cdp) {
  const previousAttempt = await cdp.evaluate(`app.plugins.plugins['kos-companion'].sync.getSnapshot().lastAttemptedSync`);
  await cdp.evaluate(`app.commands.executeCommandById('kos-companion:open-system')`);
  await waitFor(
    () => cdp.evaluate(`Boolean([...document.querySelectorAll('#kos-board-system .kos-board-button')]
      .some((button) => button.textContent === '立即双向同步' || button.textContent === '重试同步'))`),
    '驾驶舱双向同步按钮',
  );
  await cdp.evaluate(`(() => {
    const button = [...document.querySelectorAll('#kos-board-system .kos-board-button')]
      .find((item) => item.textContent === '立即双向同步' || item.textContent === '重试同步');
    button.click();
  })()`);
  return waitFor(async () => {
    const state = await cdp.evaluate(`(() => {
      const snapshot = app.plugins.plugins['kos-companion'].sync.getSnapshot();
      const card = document.querySelector('#kos-board-system');
      return {
        snapshot,
        hasAttempt: card?.textContent.includes('最后尝试'),
        hasSuccess: card?.textContent.includes('最后成功'),
        hasDuration: card?.textContent.includes('上次耗时'),
      };
    })()`);
    const completed = state.snapshot.lastAttemptedSync
      && state.snapshot.lastAttemptedSync !== previousAttempt
      && ['up-to-date', 'conflict'].includes(state.snapshot.phase);
    return completed && state.hasAttempt && state.hasSuccess && state.hasDuration ? state.snapshot : null;
  }, '驾驶舱完成手动双向同步', 90_000);
}

async function assertRuntimeIntact(cdp, stage) {
  const state = await cdp.evaluate(`(() => ({
    taskTemplate: Boolean(app.vault.getFileByPath('90_系统/模板/Task_任务模板.md')),
    quickStart: Boolean(app.vault.getFileByPath('90_系统/文档/00_快速开始.md')),
    systemSkill: Boolean(app.vault.getFileByPath('80_Skills/core/kos-system-check/SKILL.md')),
    includedFiles: app.vault.getFiles().filter((file) =>
      !file.path.startsWith('.obsidian/')
      && !file.path.startsWith('.git/')
      && file.path !== '.kos.md'
      && file.path !== '.hermes.md'
    ).length,
  }))()`);
  if (
    !state.taskTemplate
    || !state.quickStart
    || !state.systemSkill
    || state.includedFiles < 70
  ) {
    throw new Error(`${stage} 后 Runtime 基线被破坏：${JSON.stringify(state)}`);
  }
}

async function exerciseRoundTrip(first, second) {
  const path = `10_收件箱/新用户同步验收-${Date.now()}.md`;
  const initial = `# 新用户同步验收\n\n由第一台设备创建。\n`;
  const updated = `# 新用户同步验收\n\n由第二台设备修改。\n`;
  await first.evaluate(`(async () => {
    await app.vault.create(${JSON.stringify(path)}, ${JSON.stringify(initial)});
  })()`);
  await syncNowThroughDashboard(first);
  await waitFor(async () => {
    await syncNow(second);
    return second.evaluate(`app.vault.getFileByPath(${JSON.stringify(path)})
      ? app.vault.read(app.vault.getFileByPath(${JSON.stringify(path)}))
      : null`);
  }, '第一台设备创建的文件出现在第二台设备', 90_000);
  await assertRuntimeIntact(first, '创建同步（设备 A）');
  await assertRuntimeIntact(second, '创建同步（设备 B）');

  await second.evaluate(`(async () => {
    const file = app.vault.getFileByPath(${JSON.stringify(path)});
    await app.vault.modify(file, ${JSON.stringify(updated)});
  })()`);
  await waitFor(async () => {
    await syncNow(second);
    await syncNow(first);
    return first.evaluate(`(async () => {
      const file = app.vault.getFileByPath(${JSON.stringify(path)});
      return file ? (await app.vault.read(file)) === ${JSON.stringify(updated)} : false;
    })()`);
  }, '第二台设备的修改返回第一台设备', 90_000);
  await assertRuntimeIntact(first, '修改同步（设备 A）');
  await assertRuntimeIntact(second, '修改同步（设备 B）');

  await first.evaluate(`(async () => {
    const file = app.vault.getFileByPath(${JSON.stringify(path)});
    await app.vault.delete(file, true);
  })()`);
  await waitFor(async () => {
    await syncNow(first);
    await syncNow(second);
    return second.evaluate(`!app.vault.getFileByPath(${JSON.stringify(path)})`);
  }, '第一台设备的删除传到第二台设备', 90_000);
  await assertRuntimeIntact(first, '删除同步（设备 A）');
  await assertRuntimeIntact(second, '删除同步（设备 B）');
  return path;
}

async function sanitizeDevice(cdp) {
  await cdp.evaluate(`(async () => {
    const plugin = app.plugins.plugins['kos-companion'];
    await plugin.sync.stop();
    plugin.settings.sync = {
      enabled: false,
      paused: false,
      accountId: '',
      bucket: '',
      accessKeyId: '',
      secretAccessKey: '',
      vaultId: '',
    };
    await plugin.saveSettings();
  })()`);
}

async function clearRemotePrefix(sync, vaultId) {
  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${sync.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: sync.accessKeyId,
      secretAccessKey: sync.secretAccessKey,
    },
  });
  const prefix = `kos-sync/v1/${vaultId}/`;
  let continuationToken;
  do {
    const page = await client.send(new ListObjectsV2Command({
      Bucket: sync.bucket,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    }));
    const objects = (page.Contents ?? [])
      .flatMap((object) => object.Key ? [{ Key: object.Key }] : []);
    if (objects.length > 0) {
      await client.send(new DeleteObjectsCommand({
        Bucket: sync.bucket,
        Delete: { Objects: objects, Quiet: true },
      }));
    }
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);
  const remaining = await client.send(new ListObjectsV2Command({
    Bucket: sync.bucket,
    Prefix: prefix,
    MaxKeys: 1,
  }));
  if ((remaining.KeyCount ?? 0) !== 0) throw new Error('真实 R2 测试前缀清理失败');
  client.destroy();
}

export async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolveExit) => child.once('exit', resolveExit));
  child.kill('SIGTERM');
  await Promise.race([
    exited,
    new Promise((resolveTimeout) => setTimeout(resolveTimeout, 5_000)),
  ]);
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
}

async function main() {
  const missing = requiredEnvironment.filter((name) => !process.env[name]?.trim());
  if (missing.length > 0) fail(`缺少环境变量：${missing.join(', ')}`);
  if (!(await exists(obsidianBin))) fail(`未找到 Obsidian：${obsidianBin}`);

  const firstVault = resolve(process.env.KOS_NEW_USER_VAULT_A);
  const secondVault = resolve(process.env.KOS_NEW_USER_VAULT_B);
  if (firstVault === secondVault) fail('两个验收 Vault 不能是同一路径');
  const sync = {
    accountId: process.env.KOS_R2_ACCOUNT_ID.trim(),
    bucket: process.env.KOS_R2_BUCKET.trim(),
    accessKeyId: process.env.KOS_R2_ACCESS_KEY_ID.trim(),
    secretAccessKey: process.env.KOS_R2_SECRET_ACCESS_KEY.trim(),
  };
  const preserveRemote = process.env.KOS_NEW_USER_PRESERVE_REMOTE === '1';
  const sourceOnly = process.env.KOS_NEW_USER_SOURCE_ONLY === '1';
  if (sourceOnly && !preserveRemote) {
    fail('KOS_NEW_USER_SOURCE_ONLY=1 必须同时设置 KOS_NEW_USER_PRESERVE_REMOTE=1，避免清理物理验收远端');
  }
  if (preserveRemote) {
    console.error('注意：本次验收会保留 R2 前缀和 Vault 内同步凭据；完成物理验收后必须显式清理并轮换测试凭据。');
  }

  const runtimeRoot = await mkdtemp(join(tmpdir(), 'kos-new-user-sync-'));
  const firstPort = 9261;
  const secondPort = 9262;
  let first;
  let second;
  let vaultId = '';
  try {
    if (sourceOnly) {
      first = await launchObsidian(firstVault, join(runtimeRoot, 'profile-source'), firstPort);
      const result = await first.cdp.evaluate(`(async () => {
        const plugin = app.plugins.plugins['kos-companion'];
        await plugin.reloadSync();
        return {
          vaultId: plugin.settings.sync.vaultId,
          snapshot: plugin.sync.getSnapshot(),
        };
      })()`);
      if (result.snapshot.phase !== 'up-to-date') {
        throw new Error(`源端未进入已同步状态：${result.snapshot.phase} / ${result.snapshot.message}`);
      }
      console.log(JSON.stringify({ passed: true, sourceOnly: true, ...result }, null, 2));
      return;
    }
    await prepareVault(firstVault);
    await prepareVault(secondVault);
    first = await launchObsidian(firstVault, join(runtimeRoot, 'profile-a'), firstPort);
    const profileMarker = `profile-a-${Date.now()}`;
    await first.cdp.evaluate(`localStorage.setItem('kos-new-user-profile-marker', ${JSON.stringify(profileMarker)})`);
    second = await launchObsidian(secondVault, join(runtimeRoot, 'profile-b'), secondPort);
    const secondMarker = await second.cdp.evaluate(`localStorage.getItem('kos-new-user-profile-marker')`);
    if (secondMarker === profileMarker) {
      throw new Error('两个 Obsidian 验收实例共享浏览器存储，不能代表两台独立设备');
    }
    vaultId = await configureFirstDevice(first.cdp, sync);
    await assertRuntimeIntact(first.cdp, '首台设备初始化');
    const joinCode = createJoinCode(sync, vaultId);
    await joinSecondDeviceThroughUi(second.cdp, joinCode);
    await assertRuntimeIntact(first.cdp, '第二台设备加入（设备 A）');
    await assertRuntimeIntact(second.cdp, '第二台设备加入（设备 B）');
    const exercisedPath = await exerciseRoundTrip(first.cdp, second.cdp);
    console.log(JSON.stringify({
      passed: true,
      firstVault,
      secondVault,
      exercisedPath,
      scenarios: ['first-device-setup', 'join-code-ui', 'create', 'update', 'delete'],
      credentialsPersisted: preserveRemote,
      remotePrefixCleaned: !preserveRemote,
      vaultId,
    }, null, 2));
  } finally {
    if (first?.cdp) {
      if (!preserveRemote) {
        try { await sanitizeDevice(first.cdp); } catch { /* preserve primary failure */ }
      }
      first.cdp.close();
    }
    if (second?.cdp) {
      if (!preserveRemote) {
        try { await sanitizeDevice(second.cdp); } catch { /* preserve primary failure */ }
      }
      second.cdp.close();
    }
    await Promise.all([
      stopChild(first?.child),
      stopChild(second?.child),
    ]);
    if (vaultId && !preserveRemote) {
      try { await clearRemotePrefix(sync, vaultId); } catch (error) {
        console.error(`清理 R2 测试前缀失败：${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
      }
    }
    await rm(runtimeRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  }
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
}
