import { randomUUID } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ensureAgentVaultId,
  migrateLegacySessions,
  resolveAgentSessionStorage,
} from '../src/bridge/session-storage';

const tempDirs: string[] = [];
const runtime = {
  fs: { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync },
  path: { dirname, join },
};

afterEach(() => {
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'kos-session-storage-'));
  tempDirs.push(root);
  return root;
}

describe('kos-agent external session storage', () => {
  it('keeps a valid Vault ID and replaces an invalid one', () => {
    const existing = randomUUID();
    expect(ensureAgentVaultId(existing, randomUUID)).toBe(existing);
    expect(ensureAgentVaultId('../unsafe', randomUUID)).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('resolves the active session directory outside the Vault', async () => {
    const root = await tempRoot();
    const home = join(root, 'home');
    const vault = join(root, 'vault');
    const id = randomUUID();
    const storage = resolveAgentSessionStorage(vault, id, home, runtime.path);

    expect(storage.sessionDir).toBe(join(home, '.kos-agent', 'agent', 'sessions', id));
    expect(storage.legacySessionDir).toBe(join(vault, '.obsidian', 'kos-agent', 'sessions'));
    expect(storage.sessionDir.startsWith(vault)).toBe(false);
  });

  it('moves the legacy directory without changing session content', async () => {
    const root = await tempRoot();
    const storage = resolveAgentSessionStorage(join(root, 'vault'), randomUUID(), join(root, 'home'), runtime.path);
    mkdirSync(join(storage.legacySessionDir, 'nested'), { recursive: true });
    writeFileSync(join(storage.legacySessionDir, 'nested', 'session.jsonl'), 'session\n');

    expect(migrateLegacySessions(storage, runtime)).toBe('moved');
    expect(readFileSync(join(storage.sessionDir, 'nested', 'session.jsonl'), 'utf8')).toBe('session\n');
    expect(existsSync(storage.legacySessionDir)).toBe(false);
  });

  it('copies then removes legacy sessions when an atomic move crosses filesystems', async () => {
    const root = await tempRoot();
    const storage = resolveAgentSessionStorage(join(root, 'vault'), randomUUID(), join(root, 'home'), runtime.path);
    mkdirSync(storage.legacySessionDir, { recursive: true });
    writeFileSync(join(storage.legacySessionDir, 'session.jsonl'), 'session\n');
    const crossDeviceRuntime = {
      ...runtime,
      fs: {
        ...runtime.fs,
        renameSync: () => {
          const error = new Error('cross-device move') as NodeJS.ErrnoException;
          error.code = 'EXDEV';
          throw error;
        },
      },
    };

    expect(migrateLegacySessions(storage, crossDeviceRuntime)).toBe('merged');
    expect(readFileSync(join(storage.sessionDir, 'session.jsonl'), 'utf8')).toBe('session\n');
    expect(existsSync(storage.legacySessionDir)).toBe(false);
  });

  it('merges non-conflicting legacy sessions and removes the old directory', async () => {
    const root = await tempRoot();
    const storage = resolveAgentSessionStorage(join(root, 'vault'), randomUUID(), join(root, 'home'), runtime.path);
    mkdirSync(storage.legacySessionDir, { recursive: true });
    mkdirSync(storage.sessionDir, { recursive: true });
    writeFileSync(join(storage.legacySessionDir, 'old.jsonl'), 'old\n');
    writeFileSync(join(storage.sessionDir, 'new.jsonl'), 'new\n');

    expect(migrateLegacySessions(storage, runtime)).toBe('merged');
    expect(readFileSync(join(storage.sessionDir, 'old.jsonl'), 'utf8')).toBe('old\n');
    expect(readFileSync(join(storage.sessionDir, 'new.jsonl'), 'utf8')).toBe('new\n');
    expect(existsSync(storage.legacySessionDir)).toBe(false);
  });

  it('preserves legacy data when a destination session conflicts', async () => {
    const root = await tempRoot();
    const storage = resolveAgentSessionStorage(join(root, 'vault'), randomUUID(), join(root, 'home'), runtime.path);
    mkdirSync(storage.legacySessionDir, { recursive: true });
    mkdirSync(storage.sessionDir, { recursive: true });
    writeFileSync(join(storage.legacySessionDir, 'same.jsonl'), 'legacy\n');
    writeFileSync(join(storage.sessionDir, 'same.jsonl'), 'current\n');

    expect(() => migrateLegacySessions(storage, runtime)).toThrow('迁移冲突');
    expect(readFileSync(join(storage.legacySessionDir, 'same.jsonl'), 'utf8')).toBe('legacy\n');
    expect(readFileSync(join(storage.sessionDir, 'same.jsonl'), 'utf8')).toBe('current\n');
  });
});
