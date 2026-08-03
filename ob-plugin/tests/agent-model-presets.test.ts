import { describe, expect, it } from 'vitest';
import { VOLCENGINE_CODING_PLAN_PRESET } from '../src/agent/model-presets';

describe('model presets', () => {
  it('keeps Volcengine Coding Plan on its subscription gateway and compatible protocol', () => {
    expect(VOLCENGINE_CODING_PLAN_PRESET).toEqual({
      provider: 'volcengine-coding-plan',
      modelId: 'ark-code-latest',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/coding/v3',
      api: 'openai-completions',
    });
    expect(VOLCENGINE_CODING_PLAN_PRESET.baseUrl).not.toBe('https://ark.cn-beijing.volces.com/api/v3');
  });
});
