import { describe, expect, it, vi } from "vitest";
import type { ExtensionAPI, ToolDefinition } from "../src/core/extensions/types.ts";
import askQuestionExtension from "../src/extensions/ask-question.ts";

function loadTool(): ToolDefinition {
	let tool: ToolDefinition | undefined;
	askQuestionExtension({
		registerTool(definition) {
			tool = definition;
		},
	} as ExtensionAPI);
	if (!tool) throw new Error("ask_question was not registered");
	return tool;
}

describe("ask_question extension", () => {
	it("uses portable extension UI and returns structured answers", async () => {
		const tool = loadTool();
		const select = vi.fn().mockResolvedValue("Review now - Pause until the user has reviewed the result");
		const input = vi.fn();
		const result = await tool.execute(
			"call-1",
			{
				questions: [
					{
						header: "review",
						question: "How should this research close?",
						options: [{ label: "Review now", description: "Pause until the user has reviewed the result" }],
					},
				],
			},
			undefined,
			undefined,
			{ ui: { select, input } } as never,
		);

		expect(select).toHaveBeenCalledOnce();
		expect(input).not.toHaveBeenCalled();
		expect(result.details).toEqual({ answers: { review: "Review now" }, cancelled: false });
	});

	it("supports free-form questions and cancellation", async () => {
		const tool = loadTool();
		const result = await tool.execute(
			"call-2",
			{ questions: [{ header: "scope", question: "What is in scope?" }] },
			undefined,
			undefined,
			{ ui: { input: vi.fn().mockResolvedValue(undefined) } } as never,
		);

		expect(result.details).toEqual({ answers: {}, cancelled: true });
	});
});
