import { describe, expect, it, vi } from "vitest";
import { fetchRemoteUrl, validateRemoteUrl } from "../src/extensions/web/security.ts";

const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];

describe("Web SSRF protection", () => {
	it.each([
		"http://localhost/secret",
		"http://127.0.0.1/secret",
		"http://10.0.0.1/secret",
		"http://169.254.169.254/latest/meta-data",
		"http://192.168.1.1/secret",
		"http://192.0.2.1/documentation",
		"http://[::1]/secret",
		"http://[fc00::1]/secret",
		"http://[fe80::1]/secret",
		"http://[::ffff:127.0.0.1]/secret",
		"file:///etc/passwd",
	])("blocks non-public target %s", async (url) => {
		await expect(validateRemoteUrl(url)).rejects.toThrow();
	});

	it("rejects a hostname when any DNS answer is private", async () => {
		await expect(validateRemoteUrl("https://example.test", {
			lookup: async () => [
				{ address: "93.184.216.34", family: 4 },
				{ address: "127.0.0.1", family: 4 },
			],
		})).rejects.toThrow("Blocked internal or reserved address");
	});

	it("revalidates every redirect target", async () => {
		const fetchMock = vi.fn().mockResolvedValue(new Response(null, {
			status: 302,
			headers: { location: "http://127.0.0.1/admin" },
		}));
		await expect(fetchRemoteUrl("https://public.example/start", {}, {
			lookup: publicLookup,
			fetch: fetchMock,
		})).rejects.toThrow("Blocked internal or reserved address");
		expect(fetchMock).toHaveBeenCalledOnce();
	});

	it("enforces the redirect limit", async () => {
		const fetchMock = vi.fn().mockImplementation(async (url: URL) => new Response(null, {
			status: 302,
			headers: { location: `${url.origin}/again` },
		}));
		await expect(fetchRemoteUrl("https://public.example/start", {}, {
			lookup: publicLookup,
			fetch: fetchMock,
			maxRedirects: 2,
		})).rejects.toThrow("Too many redirects");
		expect(fetchMock).toHaveBeenCalledTimes(3);
	});
});
