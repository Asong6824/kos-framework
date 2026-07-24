/**
 * kos-agent session storage must stay outside the Vault so file sync engines
 * cannot replicate model conversations or tool traces to mobile devices.
 */

export interface SessionStoragePath {
  dirname(path: string): string;
  join(...paths: string[]): string;
}

export interface SessionStorageDirent {
  name: string;
  isDirectory(): boolean;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}

export interface SessionStorageFs {
  copyFileSync(source: string, destination: string): void;
  existsSync(path: string): boolean;
  mkdirSync(path: string, options: { recursive: true }): unknown;
  readFileSync(path: string): Uint8Array;
  readdirSync(path: string, options: { withFileTypes: true }): SessionStorageDirent[];
  renameSync(source: string, destination: string): void;
  rmSync(path: string, options: { recursive: true; force: true }): void;
}

export interface SessionStorageRuntime {
  fs: SessionStorageFs;
  path: SessionStoragePath;
}

export interface AgentSessionStorage {
  sessionDir: string;
  legacySessionDir: string;
}

export type SessionMigrationResult = 'not-needed' | 'moved' | 'merged';

const VAULT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isAgentVaultId(value: unknown): value is string {
  return typeof value === 'string' && VAULT_ID_PATTERN.test(value);
}

export function ensureAgentVaultId(current: unknown, randomUUID: () => string): string {
  if (isAgentVaultId(current)) return current.toLowerCase();
  const generated = randomUUID();
  if (!isAgentVaultId(generated)) throw new Error('无法生成有效的 kos-agent Vault ID');
  return generated.toLowerCase();
}

export function resolveAgentSessionStorage(
  vaultRoot: string,
  agentVaultId: string,
  homeDir: string,
  path: SessionStoragePath,
): AgentSessionStorage {
  if (!isAgentVaultId(agentVaultId)) throw new Error('kos-agent Vault ID 无效，请重新加载 kos Companion');
  return {
    sessionDir: path.join(homeDir, '.kos-agent', 'agent', 'sessions', agentVaultId.toLowerCase()),
    legacySessionDir: path.join(vaultRoot, '.obsidian', 'kos-agent', 'sessions'),
  };
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index++) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function assertMergeable(source: string, destination: string, runtime: SessionStorageRuntime): void {
  const { fs, path } = runtime;
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`旧 kos-agent Session 包含不支持的符号链接：${sourcePath}`);
    }
    if (entry.isDirectory()) {
      if (fs.existsSync(destinationPath)) {
        assertMergeable(sourcePath, destinationPath, runtime);
      }
      continue;
    }
    if (!entry.isFile()) throw new Error(`旧 kos-agent Session 包含不支持的文件类型：${sourcePath}`);
    if (
      fs.existsSync(destinationPath)
      && !bytesEqual(fs.readFileSync(sourcePath), fs.readFileSync(destinationPath))
    ) {
      throw new Error(`kos-agent Session 迁移冲突，旧数据已保留：${sourcePath}`);
    }
  }
}

function copyTree(source: string, destination: string, runtime: SessionStorageRuntime): void {
  const { fs, path } = runtime;
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);
    if (entry.isDirectory()) copyTree(sourcePath, destinationPath, runtime);
    else if (!fs.existsSync(destinationPath)) fs.copyFileSync(sourcePath, destinationPath);
  }
}

/**
 * Move legacy in-Vault sessions to the per-Vault external directory.
 * A conflicting destination aborts before the legacy directory is removed.
 */
export function migrateLegacySessions(
  storage: AgentSessionStorage,
  runtime: SessionStorageRuntime,
): SessionMigrationResult {
  const { fs, path } = runtime;
  if (!fs.existsSync(storage.legacySessionDir)) return 'not-needed';

  fs.mkdirSync(path.dirname(storage.sessionDir), { recursive: true });
  if (!fs.existsSync(storage.sessionDir)) {
    try {
      fs.renameSync(storage.legacySessionDir, storage.sessionDir);
      return 'moved';
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
    }
  }

  assertMergeable(storage.legacySessionDir, storage.sessionDir, runtime);
  copyTree(storage.legacySessionDir, storage.sessionDir, runtime);
  fs.rmSync(storage.legacySessionDir, { recursive: true, force: true });
  return 'merged';
}
