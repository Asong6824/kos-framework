import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { normalizeModelConfiguration, writeModelConfiguration } from "../src/kos/model-configuration.ts";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("kos model configuration", () => {
	it("validates custom endpoints and writes only non-secret metadata", () => {
		const root = mkdtempSync(join(tmpdir(), "kos-model-config-"));
		roots.push(root);
		const path = join(root, "models.json");
		const input = normalizeModelConfiguration({
			provider: "custom",
			modelId: "model-1",
			apiKey: "secret-test-value",
			baseUrl: "https://example.invalid/v1",
			api: "openai-responses",
		});
		writeModelConfiguration(path, input, false);
		const content = readFileSync(path, "utf8");
		expect(content).toContain('"model-1"');
		expect(content).toContain('"openai-responses"');
		expect(content).not.toContain("secret-test-value");
		if (process.platform !== "win32") expect(statSync(path).mode & 0o777).toBe(0o600);
	});

	it("does not create models.json for an existing built-in model without overrides", () => {
		const root = mkdtempSync(join(tmpdir(), "kos-model-config-"));
		roots.push(root);
		const path = join(root, "models.json");
		writeModelConfiguration(path, {
			provider: "anthropic",
			modelId: "claude",
			apiKey: "not-written",
		}, true);
		expect(existsSync(path)).toBe(false);
	});

	it("requires endpoint metadata for an unknown model", () => {
		const root = mkdtempSync(join(tmpdir(), "kos-model-config-"));
		roots.push(root);
		expect(() => writeModelConfiguration(join(root, "models.json"), {
			provider: "custom",
			modelId: "model-1",
			apiKey: "key",
		}, false)).toThrow(/Base URL and API protocol/);
	});
});
