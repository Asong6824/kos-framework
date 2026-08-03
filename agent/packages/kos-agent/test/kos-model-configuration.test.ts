import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
	explainModelConnectionFailure,
	normalizeModelConfiguration,
	writeModelConfiguration,
} from "../src/kos/model-configuration.ts";

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

	it("explains connection failures without echoing provider response bodies or credentials", () => {
		expect(explainModelConnectionFailure(new Error("401 invalid api key secret-value"))).toBe(
			"模型认证失败：请检查 API key 是否正确、有效并属于当前服务",
		);
		expect(explainModelConnectionFailure(new Error("upstream dumped secret-value"))).toBe(
			"模型连接测试失败：请检查 Base URL、API 协议、model ID 和服务状态",
		);
	});
});
