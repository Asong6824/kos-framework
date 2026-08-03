import type { KosModelApi } from './protocol';

export interface KosModelPreset {
  provider: string;
  modelId: string;
  baseUrl: string;
  api: KosModelApi;
}

/** Coding Plan uses a dedicated subscription gateway, not Ark's metered inference endpoint. */
export const VOLCENGINE_CODING_PLAN_PRESET: Readonly<KosModelPreset> = Object.freeze({
  provider: 'volcengine-coding-plan',
  modelId: 'ark-code-latest',
  baseUrl: 'https://ark.cn-beijing.volces.com/api/coding/v3',
  api: 'openai-completions',
});
