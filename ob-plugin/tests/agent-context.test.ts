import { describe, expect, it } from 'vitest';
import { buildAgentPrompt } from '../src/agent/context';

describe('agent context', () => {
  it('keeps a plain prompt unchanged when no note is attached', () => {
    expect(buildAgentPrompt('hello')).toBe('hello');
  });

  it('encodes attached note data as JSON and keeps the user request last', () => {
    const prompt = buildAgentPrompt('summarize it', {
      path: '21_研究/example.md',
      content: 'content with </context> and "quotes"',
      kind: 'selection',
    });
    expect(prompt).toContain('"path":"21_研究/example.md"');
    expect(prompt).toContain('"kind":"selection"');
    expect(prompt.endsWith('\nsummarize it')).toBe(true);
  });
});
