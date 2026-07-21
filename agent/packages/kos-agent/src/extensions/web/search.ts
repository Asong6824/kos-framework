export type WebSearchProvider = "model" | "brave" | "exa";
type CredentialWebSearchProvider = Exclude<WebSearchProvider, "model">;

export interface ModelWebSearchConfig {
	baseUrl: string;
	model: string;
	apiKey: string;
	headers?: Record<string, string>;
}

export interface WebSearchInput {
	query: string;
	count?: number;
	allowedDomains?: string[];
	blockedDomains?: string[];
	freshness?: "day" | "week" | "month" | "year";
}

export interface WebSearchResult {
	title: string;
	url: string;
	snippet: string;
}

export interface WebSearchResponse {
	provider: WebSearchProvider;
	results: WebSearchResult[];
}

export interface WebSearchRuntime {
	fetch?: typeof fetch;
	env?: NodeJS.ProcessEnv;
	storedKey?: (provider: CredentialWebSearchProvider) => string | undefined;
	modelSearch?: ModelWebSearchConfig;
}

const SEARCH_TIMEOUT_MS = 30_000;

export async function searchWeb(
	input: WebSearchInput,
	signal?: AbortSignal,
	runtime: WebSearchRuntime = {},
): Promise<WebSearchResponse> {
	const env = runtime.env ?? process.env;
	const fetchImpl = runtime.fetch ?? fetch;
	const storedKey = runtime.storedKey ?? readWebSearchApiKey;
	const provider = resolveProvider(env, storedKey, !!runtime.modelSearch);
	const timeout = AbortSignal.timeout(SEARCH_TIMEOUT_MS);
	const combinedSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
	if (provider === "brave") {
		return searchBrave(input, requireKey(env.BRAVE_SEARCH_API_KEY ?? storedKey("brave"), "Brave Search credential"), fetchImpl, combinedSignal);
	}
	if (provider === "exa") {
		return searchExa(input, requireKey(env.EXA_API_KEY ?? storedKey("exa"), "Exa credential"), fetchImpl, combinedSignal);
	}
	if (!runtime.modelSearch) throw new Error("The current model does not support OpenAI Responses Web search");
	return searchWithModel(input, runtime.modelSearch, fetchImpl, combinedSignal);
}

export function resolveProvider(
	env: NodeJS.ProcessEnv = process.env,
	storedKey: (provider: CredentialWebSearchProvider) => string | undefined = readWebSearchApiKey,
	modelSearchAvailable = false,
): WebSearchProvider {
	const configured = env.KOS_WEB_SEARCH_PROVIDER?.trim().toLowerCase() || "auto";
	if (configured !== "auto" && configured !== "model" && configured !== "brave" && configured !== "exa") {
		throw new Error("KOS_WEB_SEARCH_PROVIDER must be auto, model, brave, or exa");
	}
	if (configured === "model" || configured === "brave" || configured === "exa") return configured;
	if (normalizeKey(env.BRAVE_SEARCH_API_KEY) || normalizeKey(storedKey("brave"))) return "brave";
	if (normalizeKey(env.EXA_API_KEY) || normalizeKey(storedKey("exa"))) return "exa";
	if (modelSearchAvailable) return "model";
	throw new Error(
		"web_search needs a search provider credential. Configure Brave or Exa in the Obsidian Agent view, or set BRAVE_SEARCH_API_KEY/EXA_API_KEY.",
	);
}

async function searchWithModel(
	input: WebSearchInput,
	config: ModelWebSearchConfig,
	fetchImpl: typeof fetch,
	signal: AbortSignal,
): Promise<WebSearchResponse> {
	const filters = normalizeDomainFilters(input.allowedDomains, input.blockedDomains);
	const instructions = [
		"Search the public web and answer the query with concise source-grounded text.",
		input.freshness ? `Prefer sources from the past ${input.freshness}.` : "",
		filters.blocked.length ? `Do not use these domains: ${filters.blocked.join(", ")}.` : "",
	].filter(Boolean).join(" ");
	const webTool: Record<string, unknown> = { type: "web_search" };
	if (filters.allowed.length) webTool.filters = { allowed_domains: filters.allowed };
	const response = await fetchImpl(`${config.baseUrl.replace(/\/$/, "")}/responses`, {
		method: "POST",
		headers: {
			...config.headers,
			Authorization: `Bearer ${config.apiKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			model: config.model,
			input: input.query,
			instructions,
			tools: [webTool],
			store: false,
		}),
		signal,
	});
	if (!response.ok) throw new Error(`Model Web search returned HTTP ${response.status}`);
	const data = (await response.json()) as { output?: Array<Record<string, unknown>> };
	const results: WebSearchResult[] = [];
	const seen = new Set<string>();
	for (const item of data.output ?? []) {
		if (item.type !== "message" || !Array.isArray(item.content)) continue;
		for (const content of item.content as Array<Record<string, unknown>>) {
			const text = typeof content.text === "string" ? content.text : "";
			if (!Array.isArray(content.annotations)) continue;
			for (const annotation of content.annotations as Array<Record<string, unknown>>) {
				const url = typeof annotation.url === "string" ? annotation.url : "";
				if (!url || seen.has(url) || !matchesFilters(url, filters)) continue;
				seen.add(url);
				results.push({
					title: typeof annotation.title === "string" && annotation.title.trim() ? annotation.title : url,
					url,
					snippet: citationSnippet(text, annotation.start_index, annotation.end_index),
				});
				if (results.length >= normalizeCount(input.count)) break;
			}
		}
	}
	return { provider: "model", results };
}

function citationSnippet(text: string, start: unknown, end: unknown): string {
	if (typeof start !== "number" || typeof end !== "number") return text.slice(0, 300).trim();
	return text.slice(Math.max(0, start - 120), Math.min(text.length, end + 120)).trim().slice(0, 300);
}

async function searchBrave(
	input: WebSearchInput,
	apiKey: string,
	fetchImpl: typeof fetch,
	signal: AbortSignal,
): Promise<WebSearchResponse> {
	const count = normalizeCount(input.count);
	const filters = normalizeDomainFilters(input.allowedDomains, input.blockedDomains);
	const query = buildQuery(input.query, filters);
	const params = new URLSearchParams({ q: query, count: String(filters.active ? 20 : count) });
	const freshness = input.freshness ? { day: "pd", week: "pw", month: "pm", year: "py" }[input.freshness] : undefined;
	if (freshness) params.set("freshness", freshness);

	const response = await fetchImpl(`https://api.search.brave.com/res/v1/web/search?${params}`, {
		headers: { Accept: "application/json", "X-Subscription-Token": apiKey },
		signal,
	});
	if (!response.ok) throw new Error(`Brave Search API returned HTTP ${response.status}`);
	const data = (await response.json()) as {
		web?: { results?: Array<{ title?: string; url?: string; description?: string }> };
	};
	const results: WebSearchResult[] = [];
	for (const item of data.web?.results ?? []) {
		if (!item.url || !matchesFilters(item.url, filters)) continue;
		results.push({ title: item.title?.trim() || item.url, url: item.url, snippet: item.description?.trim() || "" });
		if (results.length >= count) break;
	}
	return { provider: "brave", results };
}

async function searchExa(
	input: WebSearchInput,
	apiKey: string,
	fetchImpl: typeof fetch,
	signal: AbortSignal,
): Promise<WebSearchResponse> {
	const count = normalizeCount(input.count);
	const filters = normalizeDomainFilters(input.allowedDomains, input.blockedDomains);
	const body: Record<string, unknown> = {
		query: input.query,
		numResults: count,
		contents: { highlights: { maxCharacters: 500 } },
	};
	if (filters.allowed.length) body.includeDomains = filters.allowed;
	if (filters.blocked.length) body.excludeDomains = filters.blocked;
	if (input.freshness) body.startPublishedDate = freshnessStart(input.freshness).toISOString();

	const response = await fetchImpl("https://api.exa.ai/search", {
		method: "POST",
		headers: { Accept: "application/json", "Content-Type": "application/json", "x-api-key": apiKey },
		body: JSON.stringify(body),
		signal,
	});
	if (!response.ok) throw new Error(`Exa Search API returned HTTP ${response.status}`);
	const data = (await response.json()) as {
		results?: Array<{ title?: string; url?: string; highlights?: string[]; text?: string }>;
	};
	const results = (data.results ?? []).flatMap((item): WebSearchResult[] => {
		if (!item.url || !matchesFilters(item.url, filters)) return [];
		return [{
			title: item.title?.trim() || item.url,
			url: item.url,
			snippet: item.highlights?.filter(Boolean).join(" … ").trim() || item.text?.slice(0, 500).trim() || "",
		}];
	}).slice(0, count);
	return { provider: "exa", results };
}

interface DomainFilters {
	allowed: string[];
	blocked: string[];
	active: boolean;
}

function normalizeDomainFilters(allowed: string[] = [], blocked: string[] = []): DomainFilters {
	const normalize = (values: string[]) => Array.from(new Set(values.map(normalizeDomain).filter((v): v is string => !!v))).slice(0, 20);
	const filters = { allowed: normalize(allowed), blocked: normalize(blocked), active: false };
	filters.active = filters.allowed.length > 0 || filters.blocked.length > 0;
	return filters;
}

function normalizeDomain(value: string): string | null {
	let input = value.trim().toLowerCase();
	if (!input) return null;
	try {
		input = new URL(input.includes("://") ? input : `https://${input}`).hostname;
	} catch {
		return null;
	}
	input = input.replace(/^\.+|\.+$/g, "");
	return /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i.test(input) ? input : null;
}

function buildQuery(query: string, filters: DomainFilters): string {
	const parts = [query];
	if (filters.allowed.length === 1) parts.push(`site:${filters.allowed[0]}`);
	if (filters.allowed.length > 1) parts.push(`(${filters.allowed.map((domain) => `site:${domain}`).join(" OR ")})`);
	for (const domain of filters.blocked) parts.push(`-site:${domain}`);
	return parts.join(" ");
}

function matchesFilters(rawUrl: string, filters: DomainFilters): boolean {
	let hostname: string;
	try {
		hostname = new URL(rawUrl).hostname.toLowerCase();
	} catch {
		return false;
	}
	const matches = (domain: string) => hostname === domain || hostname.endsWith(`.${domain}`);
	if (filters.allowed.length && !filters.allowed.some(matches)) return false;
	return !filters.blocked.some(matches);
}

function freshnessStart(freshness: NonNullable<WebSearchInput["freshness"]>): Date {
	const days = { day: 1, week: 7, month: 30, year: 365 }[freshness];
	return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function normalizeCount(count: number | undefined): number {
	return Number.isFinite(count) ? Math.max(1, Math.min(Math.floor(count!), 10)) : 5;
}

function normalizeKey(value: string | undefined): string | null {
	const normalized = value?.trim();
	return normalized ? normalized : null;
}

function requireKey(value: string | undefined, name: string): string {
	const key = normalizeKey(value);
	if (!key) throw new Error(`${name} is required for the selected web search provider`);
	return key;
}
import { readWebSearchApiKey } from "../../kos/web-configuration.ts";
