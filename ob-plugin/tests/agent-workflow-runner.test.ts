import { describe, expect, it, vi } from 'vitest';
import { runIsolatedAgentWorkflow } from '../src/agent/workflow-runner';

describe('isolated Agent workflows', () => {
  it('creates and names a fresh session before sending the exact dashboard message', async () => {
    const calls: string[] = [];
    const client = {
      newSession: vi.fn(async () => { calls.push('new-session'); return { cancelled: false }; }),
      setSessionName: vi.fn(async (name: string) => { calls.push(`name:${name}`); }),
      prompt: vi.fn(async (message: string) => { calls.push(`prompt:${message}`); }),
    };
    const ready = vi.fn(async () => { calls.push('ready'); });

    await runIsolatedAgentWorkflow(client, {
      message: '/kos-start-my-day\n\n参数：{"date":"2026-07-24"}',
      sessionName: '看板 · prioritize-today · 2026-07-24',
    }, ready);

    expect(calls).toEqual([
      'new-session',
      'name:看板 · prioritize-today · 2026-07-24',
      'ready',
      'prompt:/kos-start-my-day\n\n参数：{"date":"2026-07-24"}',
    ]);
    expect(client.prompt).toHaveBeenCalledWith('/kos-start-my-day\n\n参数：{"date":"2026-07-24"}');
  });

  it('does not send when the current Agent run prevents session isolation', async () => {
    const client = {
      newSession: vi.fn(async () => ({ cancelled: true })),
      setSessionName: vi.fn(async () => {}),
      prompt: vi.fn(async () => {}),
    };

    await expect(runIsolatedAgentWorkflow(client, { message: '/kos-end-my-day', sessionName: '看板 · end-day' }))
      .rejects.toThrow('当前 Agent 任务尚未结束');
    expect(client.prompt).not.toHaveBeenCalled();
  });
});
