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
      protocolVersion: 1,
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
    answer(process, 'get_state', { protocolVersion: 1, sessionId: 's' });
    await started;

    const abort = client.abort();
    answer(process, 'abort', undefined);
    await expect(abort).resolves.toBeUndefined();

    const steer = client.steer('change direction');
    answer(process, 'steer', undefined);
    await expect(steer).resolves.toBeUndefined();

    const followUp = client.followUp('then summarize');
    answer(process, 'follow_up', undefined);
    await expect(followUp).resolves.toBeUndefined();

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

    const excerpt = client.appendReaderExtract({
      sourcePath: '11_原材料/论文/Attention.md',
      documentPath: '附件/attention.pdf',
      kind: 'pdf',
      location: 'page:3',
      positionLabel: '第 3 页',
      text: 'selected passage',
      directories: {
        project: '30_项目',
        concept: '22_知识库',
        method: '40_方法库',
        task: '31_任务',
        source: '11_原材料',
        extract: '20_处理区/摘录',
      },
    });
    expect(JSON.parse(process.stdin.writes[process.stdin.writes.length - 1])).toMatchObject({
      type: 'append_reader_extract',
      sourcePath: '11_原材料/论文/Attention.md',
      documentPath: '附件/attention.pdf',
      location: 'page:3',
      text: 'selected passage',
    });
    answer(process, 'append_reader_extract', {
      path: '20_处理区/摘录/Attention_摘录.md',
      extractId: 'kos-reader-1234',
      created: true,
      duplicate: false,
      validation: { validatedPaths: [], findings: [], errorCount: 0, warningCount: 0, passed: true },
    });
    await expect(excerpt).resolves.toMatchObject({ created: true, duplicate: false });

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

    const webConfigured = client.configureWebSearch('brave', testCredential);
    answer(process, 'configure_web_search', { provider: 'brave' });
    await expect(webConfigured).resolves.toEqual({ provider: 'brave' });

    const webState = client.getWebSearchState();
    answer(process, 'get_web_search_state', { brave: true, exa: false });
    await expect(webState).resolves.toEqual({ brave: true, exa: false });

    const selected = client.setModel('custom', 'model-1');
    answer(process, 'set_model', { provider: 'custom', id: 'model-1' });
    await expect(selected).resolves.toEqual({ provider: 'custom', id: 'model-1' });

    const thinking = client.cycleThinkingLevel();
    answer(process, 'cycle_thinking_level', { level: 'medium' });
    await expect(thinking).resolves.toBe('medium');

    const stats = client.getSessionStats();
    answer(process, 'get_session_stats', { sessionId: 's', totalMessages: 2, toolCalls: 1, tokens: { total: 42 }, cost: 0 });
    await expect(stats).resolves.toMatchObject({ tokens: { total: 42 } });

    const sessions = client.listSessions();
    answer(process, 'list_sessions', { sessions: [{ id: 's', path: '/tmp/s.jsonl', name: 'Research' }] });
    await expect(sessions).resolves.toEqual([{ id: 's', path: '/tmp/s.jsonl', name: 'Research' }]);

    const switched = client.switchSession('/tmp/s.jsonl');
    answer(process, 'switch_session', { cancelled: false });
    await expect(switched).resolves.toEqual({ cancelled: false });

    const renamed = client.setSessionName('Research');
    answer(process, 'set_session_name', undefined);
    await expect(renamed).resolves.toBeUndefined();

    const compacted = client.compact();
    answer(process, 'compact', { summary: 'done' });
    await expect(compacted).resolves.toEqual({ summary: 'done' });

    const forkMessages = client.getForkMessages();
    answer(process, 'get_fork_messages', { messages: [{ entryId: 'e1', text: 'first' }] });
    await expect(forkMessages).resolves.toEqual([{ entryId: 'e1', text: 'first' }]);

    const tree = client.getTree();
    answer(process, 'get_tree', { tree: [{ entry: { id: 'e1', type: 'message' }, children: [] }], leafId: 'e1' });
    await expect(tree).resolves.toMatchObject({ leafId: 'e1' });

    const commands = client.getCommands();
    answer(process, 'get_commands', { commands: [{ name: 'skill:research', source: 'skill' }] });
    await expect(commands).resolves.toEqual([{ name: 'skill:research', source: 'skill' }]);

    client.respondToQuestion('question-1', { value: 'reviewed' });
    expect(JSON.parse(process.stdin.writes[process.stdin.writes.length - 1])).toEqual({
      type: 'extension_ui_response',
      id: 'question-1',
      value: 'reviewed',
    });

    const replayed: string[] = [];
    process.stdout.emit('data', `${JSON.stringify({
      type: 'extension_ui_request', id: 'question-2', method: 'confirm', title: 'Review',
    })}\n`);
    client.onEvent((event) => {
      if (event.type === 'extension_ui_request') replayed.push(event.id);
    });
    expect(replayed).toContain('question-2');
    client.respondToQuestion('question-2', { confirmed: true });
    const afterAnswer: string[] = [];
    client.onEvent((event) => {
      if (event.type === 'extension_ui_request') afterAnswer.push(event.id);
    });
    expect(afterAnswer).not.toContain('question-2');
  });
});
