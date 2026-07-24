import { FileSystemAdapter, Platform } from 'obsidian';
import type { App } from 'obsidian';
import { KosAgentClient } from '../agent/client';
import type { KosAgentProcess } from '../agent/client';
import type { KosSettings } from '../settings';
import {
  ensureAgentVaultId,
  migrateLegacySessions,
  resolveAgentSessionStorage,
} from './session-storage';

interface NodeModules {
  spawn: typeof import('node:child_process').spawn;
  spawnSync: typeof import('node:child_process').spawnSync;
  existsSync: typeof import('node:fs').existsSync;
  copyFileSync: typeof import('node:fs').copyFileSync;
  mkdirSync: typeof import('node:fs').mkdirSync;
  readFileSync: typeof import('node:fs').readFileSync;
  readdirSync: typeof import('node:fs').readdirSync;
  renameSync: typeof import('node:fs').renameSync;
  rmSync: typeof import('node:fs').rmSync;
  join: typeof import('node:path').join;
  resolve: typeof import('node:path').resolve;
  dirname: typeof import('node:path').dirname;
  delimiter: typeof import('node:path').delimiter;
  homedir: typeof import('node:os').homedir;
  randomUUID: typeof import('node:crypto').randomUUID;
}

function nodeModules(): NodeModules {
  const { spawn, spawnSync } = require('node:child_process') as typeof import('node:child_process');
  const { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync } = require('node:fs') as typeof import('node:fs');
  const { join, resolve, dirname, delimiter } = require('node:path') as typeof import('node:path');
  const { homedir } = require('node:os') as typeof import('node:os');
  const { randomUUID } = require('node:crypto') as typeof import('node:crypto');
  return {
    spawn,
    spawnSync,
    copyFileSync,
    existsSync,
    mkdirSync,
    readFileSync,
    readdirSync,
    renameSync,
    rmSync,
    join,
    resolve,
    dirname,
    delimiter,
    homedir,
    randomUUID,
  };
}

export function isKosAgentSupported(app: App): boolean {
  return Platform.isDesktopApp && app.vault.adapter instanceof FileSystemAdapter && typeof require === 'function';
}

export function initializeAgentVaultId(settings: KosSettings): boolean {
  const next = ensureAgentVaultId(settings.agentVaultId, nodeModules().randomUUID);
  if (next === settings.agentVaultId) return false;
  settings.agentVaultId = next;
  return true;
}

export function prepareAgentSessionStorage(app: App, settings: KosSettings): string {
  if (!(app.vault.adapter instanceof FileSystemAdapter)) throw new Error('kos-agent 仅支持本地文件系统 vault');
  const root = app.vault.adapter.getBasePath();
  const modules = nodeModules();
  const storage = resolveAgentSessionStorage(root, settings.agentVaultId, modules.homedir(), {
    join: modules.join,
    dirname: modules.dirname,
  });
  const migration = migrateLegacySessions(storage, {
    fs: {
      copyFileSync: modules.copyFileSync,
      existsSync: modules.existsSync,
      mkdirSync: modules.mkdirSync,
      readFileSync: modules.readFileSync,
      readdirSync: modules.readdirSync,
      renameSync: modules.renameSync,
      rmSync: modules.rmSync,
    },
    path: { join: modules.join, dirname: modules.dirname },
  });
  if (migration !== 'not-needed') console.info(`kos-agent Session 已迁移到 Vault 外部目录：${storage.sessionDir}`);
  return storage.sessionDir;
}

function resolveLaunch(app: App, settings: KosSettings): {
  command: string;
  args: string[];
  cwd: string;
  sessionDir: string;
	pathEnv: string;
} {
  if (!(app.vault.adapter instanceof FileSystemAdapter)) throw new Error('kos-agent 仅支持本地文件系统 vault');
  const root = app.vault.adapter.getBasePath();
	const modules = nodeModules();
	const { spawnSync, existsSync, join, resolve, dirname, delimiter, homedir } = modules;
  let host = settings.agentHostPath.trim();

  if (!host) {
    const developmentCandidates = [
      resolve(root, '.obsidian/plugins/kos-companion/kos-agent/dist/rpc-entry.mjs'),
      resolve(root, 'agent/packages/kos-agent/dist/rpc-entry.js'),
      resolve(root, '../agent/packages/kos-agent/dist/rpc-entry.js'),
    ];
    host = developmentCandidates.find((candidate) => existsSync(candidate)) ?? 'kos-agent';
  }

  const isScript = /\.(?:c|m)?js$/i.test(host);
  let nodeCommand = settings.agentNodePath.trim();
  if (isScript && !nodeCommand) {
    if (!process.versions.electron) {
      nodeCommand = process.execPath;
    } else {
      const executable = process.platform === 'win32' ? 'node.exe' : 'node';
      const pathCandidates = (process.env.PATH ?? '').split(delimiter).filter(Boolean).map((dir) => join(dir, executable));
      const commonCandidates = process.platform === 'win32'
        ? [join(process.env.ProgramFiles ?? '', 'nodejs', executable)]
        : [
            '/opt/homebrew/bin/node',
            '/usr/local/bin/node',
            join(homedir(), '.volta/bin/node'),
            join(homedir(), '.local/bin/node'),
          ];
      nodeCommand = [...pathCandidates, ...commonCandidates].find((candidate) => existsSync(candidate)) ?? '';
    }
  }
  if (isScript && !nodeCommand) {
    throw new Error('未找到 Node.js 22.19+。请安装 Node.js，或在 kos Companion 设置中填写 Node 路径。');
  }
  if (isScript) {
    const versionResult = spawnSync(nodeCommand, ['--version'], { encoding: 'utf8', windowsHide: true });
    const version = /^v(\d+)\.(\d+)\./.exec(versionResult.stdout.trim());
    if (versionResult.status !== 0 || !version) {
      throw new Error(`无法运行 Node.js：${nodeCommand}`);
    }
    const major = Number(version[1]);
    const minor = Number(version[2]);
    if (major < 22 || (major === 22 && minor < 19)) {
      throw new Error(`Node.js 版本过低（${versionResult.stdout.trim()}），kos-agent 需要 22.19+。`);
    }
  }
  const sessionDir = prepareAgentSessionStorage(app, settings);
  return {
    command: isScript ? nodeCommand : host,
    args: [...(isScript ? [host] : []), '--continue'],
    cwd: root,
    sessionDir,
		pathEnv: isScript ? [dirname(host), process.env.PATH ?? ''].filter(Boolean).join(delimiter) : process.env.PATH ?? '',
  };
}

export function createKosAgentClient(app: App, settings: KosSettings): KosAgentClient {
  if (!isKosAgentSupported(app)) throw new Error('当前平台不支持本地 kos-agent');
  const launch = resolveLaunch(app, settings);
  return new KosAgentClient(() => {
    const { spawn } = nodeModules();
    return spawn(launch.command, launch.args, {
      cwd: launch.cwd,
      env: {
        ...process.env,
        KOS_AGENT_SESSION_DIR: launch.sessionDir,
				PATH: launch.pathEnv,
				KOS_NODE_PATH: launch.command,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    }) as KosAgentProcess;
  });
}
