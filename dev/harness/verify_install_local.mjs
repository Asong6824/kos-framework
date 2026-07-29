#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const installer = join(repoRoot, 'dev/harness/install_local.mjs');

function runInstaller(vault) {
  const result = spawnSync(process.execPath, [installer, vault, '--skip-deps'], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 180_000,
  });
  if (result.status !== 0) {
    process.stderr.write(result.stdout);
    process.stderr.write(result.stderr);
    throw new Error(`installer exited with ${String(result.status)}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const temporaryRoot = await mkdtemp(join(tmpdir(), 'kos-install-verification-'));
const vault = join(temporaryRoot, 'kos-user-vault');
const plugin = join(vault, '.obsidian/plugins/kos-companion');
const settings = join(plugin, 'data.json');
const personalNote = join(vault, '我的测试笔记.md');

try {
  runInstaller(vault);
  const firstReceipt = JSON.parse(await readFile(join(plugin, 'INSTALLATION.json'), 'utf8'));
  assert(firstReceipt.pluginVersion, 'fresh install did not write a plugin version');
  assert(firstReceipt.installedAt, 'fresh install did not write an installation timestamp');

  const expectedSettings = { userSetting: 'must-survive-upgrade' };
  await writeFile(settings, `${JSON.stringify(expectedSettings)}\n`);
  await writeFile(personalNote, '# 用户内容必须保留\n');

  runInstaller(vault);

  const actualSettings = JSON.parse(await readFile(settings, 'utf8'));
  assert(
    actualSettings.userSetting === expectedSettings.userSetting,
    'plugin data.json was not preserved during upgrade',
  );
  assert(
    (await readFile(personalNote, 'utf8')) === '# 用户内容必须保留\n',
    'personal Vault content changed during upgrade',
  );

  const backups = await readdir(join(vault, '90_系统/framework-backups'));
  assert(
    backups.some((name) => name.startsWith('kos-companion-')),
    'upgrade did not create a recoverable plugin backup',
  );

  const secondReceipt = JSON.parse(await readFile(join(plugin, 'INSTALLATION.json'), 'utf8'));
  assert(
    secondReceipt.pluginVersion === firstReceipt.pluginVersion,
    'upgrade installed an unexpected plugin version',
  );
  assert(secondReceipt.installedAt, 'upgrade did not refresh the installation receipt');

  console.log('Local installer verification passed: fresh install, upgrade, settings, user content, backup.');
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
