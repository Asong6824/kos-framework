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
