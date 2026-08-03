import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { stripJsonComments } from "../utils/json.ts";

export const SUPPORTED_MODEL_APIS = [
	"openai-responses",
	"openai-completions",
	"anthropic-messages",
	"google-generative-ai",
] as const;

export type SupportedModelApi = (typeof SUPPORTED_MODEL_APIS)[number];

export interface ConfigureModelInput {
	provider: string;
	modelId: string;
	apiKey: string;
	baseUrl?: string;
	api?: SupportedModelApi;
}

export interface ModelConnectionTestResult {
	provider: string;
	modelId: string;
	responseModel?: string;
	latencyMs: number;
}

interface ModelsJson {
	providers: Record<string, Record<string, unknown>>;
}

function required(value: string, label: string): string {
	const normalized = value.trim();
	if (!normalized) throw new Error(`${label} is required`);
	return normalized;
}

export function normalizeModelConfiguration(input: ConfigureModelInput): ConfigureModelInput {
	const provider = required(input.provider, "Provider");
	const modelId = required(input.modelId, "Model ID");
	const apiKey = required(input.apiKey, "API key");
	const baseUrl = input.baseUrl?.trim() || undefined;
	const api = input.api;
	if (baseUrl) {
		try {
			new URL(baseUrl);
		} catch {
			throw new Error("Base URL must be an absolute URL");
		}
	}
	if (api && !SUPPORTED_MODEL_APIS.includes(api)) throw new Error(`Unsupported model API: ${api}`);
	return { provider, modelId, apiKey, baseUrl, api };
}

/** Convert provider/transport failures into useful messages without returning response bodies or credentials. */
export function explainModelConnectionFailure(value: unknown): string {
	const message = value instanceof Error ? value.message : String(value ?? "");
	if (/401|unauthorized|invalid api.?key|authentication/i.test(message)) {
		return "模型认证失败：请检查 API key 是否正确、有效并属于当前服务";
	}
	if (/403|forbidden|permission|not allowed/i.test(message)) {
		return "模型访问被拒绝：请检查套餐、模型权限和 API key 的授权范围";
	}
	if (/404|not found|unknown model|model.*(invalid|不存在)/i.test(message)) {
		return "模型或接口不存在：请检查 model ID、Base URL 和 API 协议";
	}
	if (/429|rate.?limit|too many requests/i.test(message)) {
		return "模型请求达到限流：请稍后重试并检查套餐额度";
	}
	if (/quota|insufficient.*credit|balance|额度|余额/i.test(message)) {
		return "模型额度不足：请检查套餐或账户余额";
	}
	if (/timeout|timed out|abort/i.test(message)) {
		return "模型连接超时：请检查网络、Base URL 或服务状态";
	}
	if (/network|fetch failed|econn|enotfound|certificate|tls/i.test(message)) {
		return "无法连接模型服务：请检查网络、DNS、证书和 Base URL";
	}
	return "模型连接测试失败：请检查 Base URL、API 协议、model ID 和服务状态";
}

function readModels(path: string): ModelsJson {
	if (!existsSync(path)) return { providers: {} };
	const parsed = JSON.parse(stripJsonComments(readFileSync(path, "utf8"))) as Partial<ModelsJson>;
	if (!parsed || typeof parsed !== "object" || !parsed.providers || typeof parsed.providers !== "object") {
		throw new Error(`Invalid models.json: expected a providers object (${path})`);
	}
	return { providers: { ...parsed.providers } };
}

function secureAtomicWrite(path: string, content: string): void {
	mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
	const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
	writeFileSync(temporary, content, { encoding: "utf8", mode: 0o600 });
	renameSync(temporary, path);
	chmodSync(path, 0o600);
}

/** Upsert only non-secret provider/model metadata. Credentials stay in auth.json. */
export function writeModelConfiguration(
	modelsPath: string,
	input: ConfigureModelInput,
	modelAlreadyKnown: boolean,
): void {
	if (modelAlreadyKnown && !input.baseUrl && !input.api) return;
	if (!modelAlreadyKnown && (!input.baseUrl || !input.api)) {
		throw new Error("Custom models require both Base URL and API protocol");
	}

	const config = readModels(modelsPath);
	const current = config.providers[input.provider] ?? {};
	const next: Record<string, unknown> = { ...current };
	if (input.baseUrl) next.baseUrl = input.baseUrl;
	if (input.api) next.api = input.api;
	if (!modelAlreadyKnown) {
		const models = Array.isArray(current.models) ? [...current.models] : [];
		const definition = { id: input.modelId, name: input.modelId };
		const index = models.findIndex(
			(candidate) => typeof candidate === "object" && candidate !== null && (candidate as { id?: unknown }).id === input.modelId,
		);
		if (index === -1) models.push(definition);
		else models[index] = { ...(models[index] as Record<string, unknown>), ...definition };
		next.models = models;
	}
	config.providers[input.provider] = next;
	secureAtomicWrite(modelsPath, `${JSON.stringify(config, null, 2)}\n`);
}
