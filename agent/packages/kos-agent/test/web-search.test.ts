import { describe, expect, it, vi } from "vitest";
import { resolveProvider, searchWeb } from "../src/extensions/web/search.ts";

describe("web_search", () => {
	it("selects an available provider and reports missing credentials", () => {
		expect(resolveProvider({ BRAVE_SEARCH_API_KEY: "brave" }, () => undefined)).toBe("brave");
		expect(resolveProvider({ EXA_API_KEY: "exa" }, () => undefined)).toBe("exa");
		expect(resolveProvider({}, (provider) => provider === "exa" ? "stored" : undefined)).toBe("exa");
		expect(resolveProvider({}, () => undefined, true)).toBe("model");
		expect(() => resolveProvider({}, () => undefined)).toThrow("needs a search provider credential");
	});

	it("uses the current OpenAI-compatible model Web search without leaking its key", async () => {
		const apiKey = "model-search-secret";
		const fetchMock = vi.fn().mockResolvedValue(Response.json({ output: [{
			type: "message",
			content: [{
				type: "output_text",
				text: "A cited answer",
				annotations: [{ type: "url_citation", start_index: 0, end_index: 14, title: "Source", url: "https://example.com/source" }],
			}],
		}] }));
		const result = await searchWeb({ query: "query" }, undefined, {
			env: {},
			storedKey: () => undefined,
			modelSearch: { baseUrl: "https://model.example/v1", model: "model-1", apiKey },
			fetch: fetchMock,
		});
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe("https://model.example/v1/responses");
		expect(init.body).not.toContain(apiKey);
		expect(result).toMatchObject({ provider: "model", results: [{ title: "Source" }] });
	});

	it("keeps the Brave key out of the URL and error text", async () => {
		const apiKey = "top-secret-search-key";
		const fetchMock = vi.fn().mockResolvedValue(new Response("failure", { status: 401 }));
		let error = "";
		try {
			await searchWeb({ query: "kos framework" }, undefined, {
				env: { KOS_WEB_SEARCH_PROVIDER: "brave", BRAVE_SEARCH_API_KEY: apiKey },
				storedKey: () => undefined,
				fetch: fetchMock,
			});
		} catch (caught) {
			error = caught instanceof Error ? caught.message : String(caught);
		}
		const [url, init] = fetchMock.mock.calls[0];
		expect(String(url)).not.toContain(apiKey);
		expect(error).not.toContain(apiKey);
		expect(init.headers["X-Subscription-Token"]).toBe(apiKey);
	});

	it("normalizes and filters Brave results", async () => {
		const fetchMock = vi.fn().mockResolvedValue(Response.json({
			web: { results: [
				{ title: "Allowed", url: "https://docs.example.com/a", description: "A" },
				{ title: "Blocked", url: "https://other.test/b", description: "B" },
			] },
		}));
		const result = await searchWeb({ query: "query", allowedDomains: ["example.com"] }, undefined, {
			env: { BRAVE_SEARCH_API_KEY: "key" },
			storedKey: () => undefined,
			fetch: fetchMock,
		});
		expect(result).toEqual({ provider: "brave", results: [
			{ title: "Allowed", url: "https://docs.example.com/a", snippet: "A" },
		] });
	});

	it("uses Exa without exposing the key in its request body", async () => {
		const apiKey = "exa-secret";
		const fetchMock = vi.fn().mockResolvedValue(Response.json({
			results: [{ title: "Result", url: "https://example.com", highlights: ["Evidence"] }],
		}));
		const result = await searchWeb({ query: "query" }, undefined, {
			env: { KOS_WEB_SEARCH_PROVIDER: "exa", EXA_API_KEY: apiKey },
			storedKey: () => undefined,
			fetch: fetchMock,
		});
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe("https://api.exa.ai/search");
		expect(init.body).not.toContain(apiKey);
		expect(result.results[0]?.snippet).toBe("Evidence");
	});
});
