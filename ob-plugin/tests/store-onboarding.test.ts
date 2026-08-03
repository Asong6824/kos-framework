import { describe, expect, it, vi } from 'vitest';
import type { Plugin } from 'obsidian';
import { DATA_VERSION, KosDataStore } from '../src/data/store';

function fakePlugin(raw: unknown): Plugin {
  return {
    loadData: vi.fn(async () => raw),
    saveData: vi.fn(async () => undefined),
  } as unknown as Plugin;
}

describe('KosDataStore onboarding migration', () => {
  it('starts the onboarding wizard for a fresh install', async () => {
    const store = new KosDataStore(fakePlugin(null));
    await store.load();
    expect(store.pluginData.onboarding.status).toBe('not_started');
  });

  it('does not surprise pre-v10 users with a first-use wizard', async () => {
    const store = new KosDataStore(fakePlugin({ version: 9, settings: {} }));
    await store.load();
    expect(store.pluginData.onboarding.status).toBe('completed');
    expect(store.pluginData.version).toBe(DATA_VERSION);
  });

  it('preserves v10 progress and successful preflight metadata', async () => {
    const store = new KosDataStore(fakePlugin({
      version: 10,
      settings: {},
      onboarding: { status: 'in_progress', validationPassedAt: '2026-07-31T00:00:00.000Z' },
      syncPreflight: { fingerprint: 'abc', passedAt: '2026-07-31T00:01:00.000Z' },
    }));
    await store.load();
    expect(store.pluginData.onboarding).toMatchObject({ status: 'in_progress', validationPassedAt: '2026-07-31T00:00:00.000Z' });
    expect(store.pluginData.syncPreflight).toEqual({ fingerprint: 'abc', passedAt: '2026-07-31T00:01:00.000Z' });
  });

  it('runs the post-save permission hook after data is persisted', async () => {
    const plugin = fakePlugin(null);
    const afterSave = vi.fn();
    const store = new KosDataStore(plugin, afterSave);
    await store.load();
    await store.save();
    expect(plugin.saveData).toHaveBeenCalledOnce();
    expect(afterSave).toHaveBeenCalledOnce();
  });
});
