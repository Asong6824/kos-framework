#!/usr/bin/env node

import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchObsidian, stopChild, waitFor } from './verify_new_user_sync.mjs';

const requiredEnvironment = [
  'KOS_CONFIGURE_VAULT',
  'KOS_R2_ACCOUNT_ID',
  'KOS_R2_BUCKET',
  'KOS_R2_ACCESS_KEY_ID',
  'KOS_R2_SECRET_ACCESS_KEY',
  'KOS_R2_VAULT_ID',
];

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`缺少环境变量：${name}`);
  return value;
}

async function main() {
  for (const name of requiredEnvironment) required(name);
  const vault = resolve(required('KOS_CONFIGURE_VAULT'));
  const profileRoot = await mkdtemp(join(tmpdir(), 'kos-configure-sync-'));
  const profile = join(profileRoot, 'profile');
  await mkdir(join(vault, '.obsidian'), { recursive: true });
  await writeFile(join(vault, '.obsidian', 'community-plugins.json'), '["kos-companion"]\n');

  let running;
  try {
    running = await launchObsidian(vault, profile, 9268);
    const input = {
      enabled: true,
      paused: false,
      accountId: required('KOS_R2_ACCOUNT_ID'),
      bucket: required('KOS_R2_BUCKET'),
      accessKeyId: required('KOS_R2_ACCESS_KEY_ID'),
      secretAccessKey: required('KOS_R2_SECRET_ACCESS_KEY'),
      vaultId: required('KOS_R2_VAULT_ID'),
    };
    const preflight = await running.cdp.evaluate(`(async () => {
      const plugin = app.plugins.plugins['kos-companion'];
      const tested = await plugin.testSyncConfiguration(${JSON.stringify(input)}, true);
      plugin.settings.sync.enabled = true;
      await plugin.saveSettings();
      const snapshot = await plugin.reloadSync();
      return { result: tested.result, snapshot };
    })()`);
    let completed = await waitFor(async () => {
      const state = await running.cdp.evaluate(`(() => {
        const plugin = app.plugins.plugins['kos-companion'];
        const snapshot = plugin.sync.getSnapshot();
          const conflicts = app.vault.getFiles().map((file) => file.path).filter((path) =>
            path.includes('.sync-conflict-') && !path.startsWith('90_系统/framework-backups/')
          );
        return {
          snapshot,
          files: app.vault.getFiles().filter((file) => !file.path.startsWith('.obsidian/')).length,
          conflicts,
          quickStart: Boolean(app.vault.getFileByPath('90_系统/文档/00_快速开始.md')),
        };
      })()`);
      if (state.snapshot.phase === 'error' || state.snapshot.phase === 'offline') {
        throw new Error(`${state.snapshot.phase} / ${state.snapshot.message}`);
      }
      return ['up-to-date', 'conflict'].includes(state.snapshot.phase) ? state : null;
    }, '首次同步完成', 120_000);
    let resolvedFrameworkConflicts = [];
    if (process.env.KOS_RESOLVE_FRAMEWORK_CONFLICTS === '1' && completed.conflicts.length > 0) {
      const repoVault = resolve(dirname(fileURLToPath(import.meta.url)), '../../vault');
      const candidates = [];
      for (const conflictPath of completed.conflicts) {
        const mainPath = conflictPath.replace(/\.sync-conflict-[^.]+(\.[^.]*)$/, '$1');
        const [mainContent, conflictContent, frameworkContent] = await Promise.all([
          readFile(join(vault, mainPath)),
          readFile(join(vault, conflictPath)),
          readFile(join(repoVault, mainPath)),
        ]);
        const mainIsCurrent = mainContent.equals(frameworkContent);
        const conflictIsCurrent = conflictContent.equals(frameworkContent);
        if (!mainIsCurrent && !conflictIsCurrent) {
          throw new Error(`拒绝自动处理非 Framework 冲突：${conflictPath}`);
        }
        candidates.push({ conflictPath, mainPath, replaceMain: !mainIsCurrent && conflictIsCurrent });
      }
      const backupRoot = join(vault, '90_系统', 'framework-backups', `sync-conflicts-${new Date().toISOString().replace(/[:.]/g, '-')}`);
      for (const candidate of candidates) {
        const mainBackup = join(backupRoot, 'main', candidate.mainPath);
        const conflictBackup = join(backupRoot, 'conflict', candidate.conflictPath);
        await mkdir(dirname(mainBackup), { recursive: true });
        await mkdir(dirname(conflictBackup), { recursive: true });
        await cp(join(vault, candidate.mainPath), mainBackup);
        await cp(join(vault, candidate.conflictPath), conflictBackup);
      }
      await running.cdp.evaluate(`(async () => {
        const plugin = app.plugins.plugins['kos-companion'];
        for (const candidate of ${JSON.stringify(candidates)}) {
          const conflict = app.vault.getFileByPath(candidate.conflictPath);
          const main = app.vault.getFileByPath(candidate.mainPath);
          if (!conflict || !main) throw new Error('待处理 Framework 冲突文件不存在');
          if (candidate.replaceMain) {
            const content = await app.vault.read(conflict);
            await app.vault.modify(main, content);
          }
          await app.vault.delete(conflict, true);
        }
        await plugin.sync.syncNow();
      })()`);
      completed = await waitFor(async () => {
        const state = await running.cdp.evaluate(`(() => {
          const plugin = app.plugins.plugins['kos-companion'];
          return {
            snapshot: plugin.sync.getSnapshot(),
            files: app.vault.getFiles().filter((file) => !file.path.startsWith('.obsidian/')).length,
            conflicts: app.vault.getFiles().map((file) => file.path).filter((path) =>
              path.includes('.sync-conflict-') && !path.startsWith('90_系统/framework-backups/')
            ),
            quickStart: Boolean(app.vault.getFileByPath('90_系统/文档/00_快速开始.md')),
          };
        })()`);
        return state.snapshot.phase === 'up-to-date' && state.conflicts.length === 0 ? state : null;
      }, 'Framework 冲突删除同步到远端', 120_000);
      resolvedFrameworkConflicts = candidates.map((candidate) => candidate.conflictPath);
    }
    if (process.env.KOS_MARK_VALIDATION_PASSED === '1') {
      await running.cdp.evaluate(`(async () => {
        const plugin = app.plugins.plugins['kos-companion'];
        plugin.store.markValidationPassed();
        await plugin.store.save();
      })()`);
    }
    console.log(JSON.stringify({
      passed: true,
      vault,
      preflight: preflight.result,
      snapshot: completed.snapshot,
      files: completed.files,
      conflicts: completed.conflicts,
      resolvedFrameworkConflicts,
      quickStart: completed.quickStart,
    }, null, 2));
  } finally {
    running?.cdp?.close();
    await stopChild(running?.child);
    await rm(profileRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  }
}

main().catch((error) => {
  console.error(`配置本地同步失败：${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
