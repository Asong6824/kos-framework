import { beforeEach, describe, expect, it, vi } from 'vitest';

class MockTFile {}

vi.mock('obsidian', () => ({
  App: class {},
  TFile: MockTFile,
  normalizePath: (path: string) => path.replace(/^\/+|\/+$/g, '').replace(/\/{2,}/g, '/'),
}));

describe('KosObsidianSyncVault', () => {
  beforeEach(() => vi.resetModules());

  it('includes .gitkeep files while pruning private Obsidian and git trees', async () => {
    const stats = new Map([
      ['README.md', { type: 'file', ctime: 1, mtime: 2, size: 3 }],
      ['20_处理区/.gitkeep', { type: 'file', ctime: 4, mtime: 5, size: 0 }],
    ]);
    const adapter = {
      list: vi.fn(async (path: string) => {
        if (path === '') return {
          files: ['README.md', '.kos.md'],
          folders: ['20_处理区', '.obsidian', '.git'],
        };
        if (path === '20_处理区') return {
          files: ['20_处理区/.gitkeep'],
          folders: [],
        };
        throw new Error(`unexpected list: ${path}`);
      }),
      stat: vi.fn(async (path: string) => stats.get(path) ?? null),
    };
    const visible = { path: 'README.md', stat: stats.get('README.md') };
    const app = {
      vault: {
        getFiles: () => [visible],
        adapter,
      },
    };
    const { KosObsidianSyncVault } = await import('../src/sync/obsidian-livesync');
    const vault = new KosObsidianSyncVault(app as never);

    await expect(vault.listFiles()).resolves.toEqual([
      { path: 'README.md', ctime: 1, mtime: 2, size: 3 },
      { path: '20_处理区/.gitkeep', ctime: 4, mtime: 5, size: 0 },
    ]);
    expect(adapter.list).not.toHaveBeenCalledWith('.obsidian');
    expect(adapter.list).not.toHaveBeenCalledWith('.git');
  });
});
