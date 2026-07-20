import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { KosAgentClient } from '../src/agent/client';
import type { KosAgentProcess } from '../src/agent/client';

const entry = resolve(import.meta.dirname, '../../agent/packages/kos-agent/dist/rpc-entry.js');
const vaultTemplates = resolve(import.meta.dirname, '../../vault/90_系统/模板');
const tempDirs: string[] = [];
const directories = {
  project: '30_项目',
  concept: '22_知识库',
  method: '40_方法库',
  task: '31_任务',
  source: '11_原材料',
};

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe.runIf(existsSync(entry))('Obsidian kos-agent process contract', () => {
  it('connects through the plugin transport and starts a resumable session', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kos-obsidian-rpc-'));
    const configDir = join(root, 'config');
    const sessionDir = join(root, 'sessions');
    tempDirs.push(root);
    const createClient = () => new KosAgentClient(() => spawn(process.execPath, [entry, '--continue'], {
        cwd: root,
        env: { ...process.env, KOS_AGENT_DIR: configDir, KOS_AGENT_SESSION_DIR: sessionDir },
        stdio: ['pipe', 'pipe', 'pipe'],
      }) as KosAgentProcess);
    const client = createClient();

    try {
      const state = await client.start();
      expect(state.sessionId).toBeTruthy();
      expect(state.isStreaming).toBe(false);
      await expect(client.getMessages()).resolves.toEqual([]);
      await expect(client.validate()).resolves.toMatchObject({ passed: false });
      await expect(client.newSession()).resolves.toEqual({ cancelled: false });
      const current = await client.getState();
      const sessionId = current.sessionId;
      await client.stop();
      if (!current.sessionFile) throw new Error('kos-agent did not provide a session file');
      await mkdir(dirname(current.sessionFile), { recursive: true });
      const timestamp = new Date().toISOString();
      await writeFile(current.sessionFile, [
        JSON.stringify({ type: 'session', version: 3, id: sessionId, timestamp, cwd: await realpath(root) }),
        JSON.stringify({
          type: 'message',
          id: 'resume-marker',
          parentId: null,
          timestamp,
          message: { role: 'user', content: [{ type: 'text', text: 'session resume marker' }], timestamp: Date.now() },
        }),
        '',
      ].join('\n'));

      const resumed = createClient();
      try {
        await expect(resumed.start()).resolves.toMatchObject({ sessionId });
      } finally {
        await resumed.stop();
      }
    } finally {
      await client.stop();
    }
  });

  it('creates and transitions an object through deterministic RPC operations', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kos-obsidian-operations-'));
    tempDirs.push(root);
    await writeFile(join(root, '.kos.md'), '# kos\n');
    await mkdir(join(root, '90_系统/模板'), { recursive: true });
    await copyFile(
      join(vaultTemplates, 'Concept_原子概念模板.md'),
      join(root, '90_系统/模板/Concept_原子概念模板.md'),
    );
    const client = new KosAgentClient(() => spawn(process.execPath, [entry, '--continue'], {
      cwd: root,
      env: {
        ...process.env,
        KOS_AGENT_DIR: join(root, 'config'),
        KOS_AGENT_SESSION_DIR: join(root, 'sessions'),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    }) as KosAgentProcess);

    try {
      await client.start();
      const created = await client.createObject({ kind: 'concept', title: 'RPC Lifecycle', directories });
      expect(created).toMatchObject({ path: '22_知识库/RPC Lifecycle.md' });
      expect(created.validation.passed).toBe(true);

      const transitioned = await client.transitionStatus({ path: created.path, target: 'verified' });
      expect(transitioned).toMatchObject({ type: 'concept', from: 'draft', to: 'verified' });
      expect(await readFile(join(root, created.path), 'utf8')).toContain('status: verified');
    } finally {
      await client.stop();
    }
  });

  it('configures a custom model without returning or duplicating its credential', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kos-obsidian-model-config-'));
    const configDir = join(root, 'config');
    tempDirs.push(root);
    const client = new KosAgentClient(() => spawn(process.execPath, [entry, '--continue'], {
      cwd: root,
      env: { ...process.env, KOS_AGENT_DIR: configDir, KOS_AGENT_SESSION_DIR: join(root, 'sessions') },
      stdio: ['pipe', 'pipe', 'pipe'],
    }) as KosAgentProcess);

    try {
      await client.start();
      const testCredential = ['integration', 'secret', 'value'].join('-');
      const model = await client.configureModel({
        provider: 'test-proxy',
        modelId: 'test-model',
        apiKey: testCredential,
        baseUrl: 'https://example.invalid/v1',
        api: 'openai-responses',
      });
      expect(model).toMatchObject({ provider: 'test-proxy', id: 'test-model' });
      expect(JSON.stringify(model)).not.toContain(testCredential);
      expect(await client.getAvailableModels()).toContainEqual(expect.objectContaining({
        provider: 'test-proxy',
        id: 'test-model',
      }));

      const modelsConfig = await readFile(join(configDir, 'models.json'), 'utf8');
      const authConfig = await readFile(join(configDir, 'auth.json'), 'utf8');
      expect(modelsConfig).not.toContain(testCredential);
      expect(authConfig).toContain(testCredential);
      if (process.platform !== 'win32') expect((await stat(join(configDir, 'auth.json'))).mode & 0o777).toBe(0o600);
    } finally {
      await client.stop();
    }
  });
});

describe.runIf(
  existsSync(entry)
    && Boolean(process.env.KOS_AGENT_DIR)
    && Boolean(process.env.KOS_LIVE_PROVIDER)
    && Boolean(process.env.KOS_LIVE_MODEL),
)('Obsidian live agent contract', () => {
  it('streams a real ask_question tool call through the plugin client and resumes after the answer', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kos-obsidian-live-'));
    tempDirs.push(root);
    const client = new KosAgentClient(() => spawn(process.execPath, [
      entry,
      '--provider', process.env.KOS_LIVE_PROVIDER!,
      '--model', process.env.KOS_LIVE_MODEL!,
    ], {
      cwd: root,
      env: { ...process.env, KOS_AGENT_SESSION_DIR: join(root, 'sessions') },
      stdio: ['pipe', 'pipe', 'pipe'],
    }) as KosAgentProcess, 120_000);
    const toolNames: string[] = [];
    let questionCount = 0;
    let settle: (() => void) | undefined;
    const settled = new Promise<void>((resolve) => {
      settle = resolve;
    });

    try {
      await client.start();
      client.onEvent((event) => {
        if (event.type === 'tool_execution_start') toolNames.push(event.toolName);
        if (event.type === 'extension_ui_request' && event.method === 'select') {
          questionCount++;
          client.respondToQuestion(event.id, { value: event.options?.[0] ?? 'Proceed' });
        }
        if (event.type === 'agent_settled') settle?.();
      });

      await client.prompt(
        'Call ask_question exactly once. Ask "Finish the live test?" with header "review" and one option labeled "Proceed". After the user answers, reply with exactly QUESTION_OK.',
      );
      await Promise.race([
        settled,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('live question timed out')), 120_000)),
      ]);

      expect(toolNames).toContain('ask_question');
      expect(questionCount).toBe(1);
      const messages = await client.getMessages();
      expect(messages.some((message) => message.role === 'assistant' && JSON.stringify(message.content).includes('QUESTION_OK'))).toBe(true);
    } finally {
      await client.stop();
    }
  }, 130_000);

  it('returns deterministic write validation to the model and lets it repair the file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kos-obsidian-validation-live-'));
    tempDirs.push(root);
    await writeFile(join(root, '.kos.md'), '# kos\n');
    await mkdir(join(root, '22_知识库'), { recursive: true });
    const client = new KosAgentClient(() => spawn(process.execPath, [
      entry,
      '--provider', process.env.KOS_LIVE_PROVIDER!,
      '--model', process.env.KOS_LIVE_MODEL!,
    ], {
      cwd: root,
      env: { ...process.env, KOS_AGENT_SESSION_DIR: join(root, 'sessions') },
      stdio: ['pipe', 'pipe', 'pipe'],
    }) as KosAgentProcess, 120_000);
    const validationResults: boolean[] = [];
    let settle: (() => void) | undefined;
    const settled = new Promise<void>((resolve) => {
      settle = resolve;
    });

    try {
      await client.start();
      client.onEvent((event) => {
        if (event.type === 'tool_execution_end' && event.toolName === 'write') {
          const validation = event.result.details?.validation;
          if (validation) validationResults.push(validation.passed);
        }
        if (event.type === 'agent_settled') settle?.();
      });

      await client.prompt([
        'Run this validation integration test exactly as instructed.',
        '1. Use write to create 22_知识库/live-validation.md with only this frontmatter: type: concept. This first write must be invalid.',
        '2. Observe the deterministic validation error returned by the tool.',
        '3. Use write again to replace it with a valid concept containing title, status=draft, confidence=draft, area=test, created=2026-07-20, and updated=2026-07-20.',
        '4. Reply exactly VALIDATION_OK after the second write passes. Do not use bash or edit.',
      ].join('\n'));
      await Promise.race([
        settled,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('live validation timed out')), 120_000)),
      ]);

      expect(validationResults).toContain(false);
      expect(validationResults[validationResults.length - 1]).toBe(true);
      const content = await readFile(join(root, '22_知识库/live-validation.md'), 'utf8');
      expect(content).toContain('status: draft');
      const messages = await client.getMessages();
      expect(messages.some((message) => message.role === 'assistant' && JSON.stringify(message.content).includes('VALIDATION_OK'))).toBe(true);
    } finally {
      await client.stop();
    }
  }, 130_000);
});
