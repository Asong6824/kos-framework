import { describe, expect, it } from "vitest";
import type { ExtensionAPI, ToolDefinition } from "../src/core/extensions/types.ts";
import webExtension from "../src/extensions/web/index.ts";

describe("Web extension", () => {
	it("registers exactly the public web_search and web_fetch tools", () => {
		const tools: ToolDefinition[] = [];
		webExtension({ registerTool: (tool) => tools.push(tool) } as ExtensionAPI);
		expect(tools.map((tool) => tool.name)).toEqual(["web_search", "web_fetch"]);
	});
});
