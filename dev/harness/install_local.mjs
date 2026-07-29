#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import {
  cp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const templateVault = join(repoRoot, 'vault');
const releaseDir = join(repoRoot, 'release/kos-companion');
const minimumNode = [22, 19, 0];

function usage() {
  console.log(`用法:
  node dev/harness/install_local.mjs <Vault 路径> [--skip-deps]

功能:
  - 空目录：初始化 kos Vault
  - 已有 kos Vault：保留个人内容，只更新 kos Companion
  - 安装依赖、构建插件与 kos-agent、安装并运行健康检查

选项:
  --skip-deps  已经执行过 npm ci 时跳过依赖安装
  --help       显示本帮助`);
}

function fail(message) {
  console.error(`\n安装失败：${message}`);
  process.exit(1);
}

function run(command, args, options = {}) {
  console.log(`\n> ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: false,
    ...options,
  });
  if (result.error) fail(result.error.message);
  if (result.status !== 0) fail(`${command} 退出，状态码 ${String(result.status)}`);
}

function assertNodeVersion() {
  const current = process.versions.node.split('.').map(Number);
  const valid =
    current[0] > minimumNode[0] ||
    (current[0] === minimumNode[0] &&
      (current[1] > minimumNode[1] ||
        (current[1] === minimumNode[1] && current[2] >= minimumNode[2])));
  if (!valid) {
    fail(`需要 Node.js 22.19.0 或更高版本，当前为 ${process.versions.node}`);
  }
}

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function isEmptyDirectory(path) {
  if (!(await pathExists(path))) return true;
  const info = await stat(path);
  if (!info.isDirectory()) fail(`目标不是目录：${path}`);
  return (await readdir(path)).length === 0;
}

async function initializeVault(target) {
  const marker = join(target, '.kos.md');
  if (await pathExists(marker)) {
    console.log(`\n检测到现有 kos Vault：${target}`);
    console.log('保留个人内容，只安装或更新 kos Companion。');
    return false;
  }

  if (!(await isEmptyDirectory(target))) {
    fail(`目标目录非空且不是 kos Vault：${target}\n请使用一个空目录，或指向包含 .kos.md 的现有 kos Vault。`);
  }

  await mkdir(target, { recursive: true });
  await cp(templateVault, target, {
    recursive: true,
    filter: (source) => !['.DS_Store', '__pycache__'].includes(basename(source)),
  });
  console.log(`\n已初始化 kos Vault：${target}`);
  return true;
}

function safeTimestamp() {
  return new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
}

async function installPlugin(vaultRoot) {
  const pluginsRoot = join(vaultRoot, '.obsidian', 'plugins');
  const pluginTarget = join(pluginsRoot, 'kos-companion');
  const staging = join(pluginsRoot, `.kos-companion-install-${process.pid}`);
  const existingData = join(pluginTarget, 'data.json');
  let backup;

  await mkdir(pluginsRoot, { recursive: true });
  await rm(staging, { recursive: true, force: true });
  await cp(releaseDir, staging, { recursive: true });

  if (await pathExists(existingData)) {
    await cp(existingData, join(staging, 'data.json'));
    console.log('已保留现有插件设置 data.json。');
  }

  if (await pathExists(pluginTarget)) {
    const backupRoot = join(vaultRoot, '90_系统', 'framework-backups');
    await mkdir(backupRoot, { recursive: true });
    backup = join(backupRoot, `kos-companion-${safeTimestamp()}`);
    await rename(pluginTarget, backup);
  }

  try {
    await rename(staging, pluginTarget);
  } catch (error) {
    if (backup && !(await pathExists(pluginTarget))) await rename(backup, pluginTarget);
    throw error;
  }

  console.log(`已安装 kos Companion：${pluginTarget}`);
  if (backup) console.log(`旧插件已备份到：${backup}`);
}

async function writeInstallReceipt(vaultRoot) {
  const manifest = JSON.parse(await readFile(join(releaseDir, 'manifest.json'), 'utf8'));
  let commit = 'unknown';
  const git = spawnSync('git', ['rev-parse', '--short=12', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (git.status === 0) commit = git.stdout.trim();

  await writeFile(
    join(vaultRoot, '.obsidian', 'plugins', 'kos-companion', 'INSTALLATION.json'),
    `${JSON.stringify({
      pluginVersion: manifest.version,
      sourceCommit: commit,
      installedAt: new Date().toISOString(),
    }, null, 2)}\n`,
  );
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    usage();
    return;
  }

  const unknown = args.filter((arg) => arg.startsWith('-') && arg !== '--skip-deps');
  if (unknown.length > 0) fail(`未知选项：${unknown.join(', ')}`);
  const positionals = args.filter((arg) => !arg.startsWith('-'));
  if (positionals.length !== 1) {
    usage();
    process.exitCode = 1;
    return;
  }

  assertNodeVersion();
  let vaultRoot = resolve(positionals[0]);
  await initializeVault(vaultRoot);
  vaultRoot = await realpath(vaultRoot);

  if (!args.includes('--skip-deps')) {
    run('npm', ['ci', '--prefix', 'agent', '--ignore-scripts']);
    run('npm', ['ci', '--prefix', 'ob-plugin', '--ignore-scripts']);
  }

  run('npm', ['run', 'build', '--prefix', 'agent']);
  run('npm', ['run', 'build', '--prefix', 'ob-plugin']);
  run(process.execPath, ['dev/harness/build_ob_plugin_release.mjs']);

  await installPlugin(vaultRoot);
  await writeInstallReceipt(vaultRoot);

  run(process.execPath, [
    join(vaultRoot, '.obsidian/plugins/kos-companion/kos-agent/dist/kos-harness.mjs'),
    'validate',
    '--root',
    vaultRoot,
  ]);

  const manifest = JSON.parse(await readFile(join(releaseDir, 'manifest.json'), 'utf8'));
  console.log(`
安装完成：kos Companion ${manifest.version}

接下来：
1. 用 Obsidian 打开 ${vaultRoot}
2. 在“设置 → 第三方插件”中启用 kos Companion
3. 打开右侧 kos Agent，配置 provider、model ID 和 API key
4. 点击“系统检查”，然后尝试“帮我开始今天的工作”
`);
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
