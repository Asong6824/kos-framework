import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { KosAgentClient } from '../src/agent/client';
import type { KosAgentProcess } from '../src/agent/client';

class FakeStream extends EventEmitter {
  writes: string[] = [];

  write(data: string): boolean {
    this.writes.push(data);
    return true;
  }

  end(): void {}
}

class FakeProcess extends EventEmitter implements KosAgentProcess {
  stdin = new FakeStream();
  stdout = new FakeStream();
  stderr = new FakeStream();
  exitCode: number | null = null;

  kill(): boolean {
    this.exitCode = 0;
    return true;
  }
}

function answer(process: FakeProcess, command: string, data: unknown): void {
  const sent = JSON.parse(process.stdin.writes[process.stdin.writes.length - 1]) as { id: string };
  process.stdout.emit('data', `${JSON.stringify({
    id: sent.id,
    type: 'response',
    command,
    success: true,
    data,
  })}\n`);
}

describe('KosAgentClient', () => {
  it('starts with get_state and preserves strict JSONL event framing', async () => {
    const process = new FakeProcess();
    const client = new KosAgentClient(() => process, 1_000);
    const events: string[] = [];
    client.onEvent((event) => events.push(event.type));

    const started = client.start();
    answer(process, 'get_state', {
      thinkingLevel: 'off',
      isStreaming: false,
      sessionId: 'session-1',
      messageCount: 0,
      pendingMessageCount: 0,
    });
    await expect(started).resolves.toMatchObject({ sessionId: 'session-1' });

    const unicodeEvent = `${JSON.stringify({ type: 'message_update', message: { role: 'assistant', content: 'a\u2028b' } })}\n`;
    const bytes = new TextEncoder().encode(unicodeEvent);
    process.stdout.emit('data', bytes.slice(0, 7));
    process.stdout.emit('data', bytes.slice(7));
    expect(events).toEqual(['message_update']);
  });

  it('correlates commands and writes extension question responses without a request id rewrite', async () => {
    const process = new FakeProcess();
    const client = new KosAgentClient(() => process, 1_000);
    const started = client.start();
    answer(process, 'get_state', { sessionId: 's' });
    await started;

    const abort = client.abort();
    answer(process, 'abort', undefined);
    await expect(abort).resolves.toBeUndefined();

    const validation = client.validate(['22_知识库/example.md']);
    answer(process, 'validate', {
      validatedPaths: ['22_知识库/example.md'],
      findings: [],
      errorCount: 0,
      warningCount: 0,
      passed: true,
    });
    await expect(validation).resolves.toMatchObject({ passed: true });

    const created = client.createObject({
      kind: 'concept',
      title: 'Agent Harness',
      directories: {
        project: '30_项目',
        concept: '22_知识库',
        method: '40_方法库',
        task: '31_任务',
        source: '11_原材料',
      },
    });
    expect(JSON.parse(process.stdin.writes[process.stdin.writes.length - 1])).toMatchObject({
      type: 'create_object',
      kind: 'concept',
      title: 'Agent Harness',
    });
    answer(process, 'create_object', {
      path: '22_知识库/Agent Harness.md',
      validation: { validatedPaths: ['22_知识库/Agent Harness.md'], findings: [], errorCount: 0, warningCount: 0, passed: true },
    });
    await expect(created).resolves.toMatchObject({ path: '22_知识库/Agent Harness.md' });

    const transitioned = client.transitionStatus({ path: '22_知识库/Agent Harness.md', target: 'verified' });
    expect(JSON.parse(process.stdin.writes[process.stdin.writes.length - 1])).toMatchObject({
      type: 'transition_status',
      path: '22_知识库/Agent Harness.md',
      target: 'verified',
    });
    answer(process, 'transition_status', {
      path: '22_知识库/Agent Harness.md',
      type: 'concept',
      from: 'draft',
      to: 'verified',
      validation: { validatedPaths: ['22_知识库/Agent Harness.md'], findings: [], errorCount: 0, warningCount: 0, passed: true },
    });
    await expect(transitioned).resolves.toMatchObject({ from: 'draft', to: 'verified' });

    const available = client.getAvailableModels();
    answer(process, 'get_available_models', { models: [{ provider: 'custom', id: 'model-1' }] });
    await expect(available).resolves.toEqual([{ provider: 'custom', id: 'model-1' }]);

    const testCredential = ['never', 'echo', 'this'].join('-');
    const configured = client.configureModel({
      provider: 'custom',
      modelId: 'model-1',
      apiKey: testCredential,
      baseUrl: 'https://example.invalid/v1',
      api: 'openai-responses',
    });
    answer(process, 'configure_model', { provider: 'custom', id: 'model-1' });
    await expect(configured).resolves.toEqual({ provider: 'custom', id: 'model-1' });

    const selected = client.setModel('custom', 'model-1');
    answer(process, 'set_model', { provider: 'custom', id: 'model-1' });
    await expect(selected).resolves.toEqual({ provider: 'custom', id: 'model-1' });

    client.respondToQuestion('question-1', { value: 'reviewed' });
    expect(JSON.parse(process.stdin.writes[process.stdin.writes.length - 1])).toEqual({
      type: 'extension_ui_response',
      id: 'question-1',
      value: 'reviewed',
    });
  });
});
