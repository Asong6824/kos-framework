import { describe, expect, test } from "vitest";
import { buildSystemPrompt } from "../src/core/system-prompt.ts";

describe("buildSystemPrompt", () => {
	describe("temporal context", () => {
		test.each([
			["2026-01-01T00:00:00.000Z", "2026-01-01", "2026-H1"],
			["2026-06-30T15:59:59.000Z", "2026-06-30", "2026-H1"],
			["2026-06-30T16:00:00.000Z", "2026-07-01", "2026-H2"],
			["2026-12-31T16:00:00.000Z", "2027-01-01", "2027-H1"],
		])("derives the local date and half-year period at boundaries", (instant, date, period) => {
			const prompt = buildSystemPrompt({
				cwd: process.cwd(),
				now: new Date(instant),
				timeZone: "Asia/Shanghai",
			});

			expect(prompt).toContain(`Current date: ${date}`);
			expect(prompt).toContain("Current timezone: Asia/Shanghai");
			expect(prompt).toContain(`Current kos goal period: ${period}`);
		});

		test("also appends temporal context to a custom system prompt", () => {
			const prompt = buildSystemPrompt({
				customPrompt: "Custom instructions",
				cwd: process.cwd(),
				now: new Date("2026-08-03T04:00:00.000Z"),
				timeZone: "Asia/Shanghai",
			});

			expect(prompt).toContain("Current date: 2026-08-03");
			expect(prompt).toContain("Current kos goal period: 2026-H2");
		});
	});

	describe("empty tools", () => {
		test("shows (none) for empty tools list", () => {
			const prompt = buildSystemPrompt({
				selectedTools: [],
				contextFiles: [],
				skills: [],
				cwd: process.cwd(),
			});

			expect(prompt).toContain("Available tools:\n(none)");
		});

		test("shows file paths guideline even with no tools", () => {
			const prompt = buildSystemPrompt({
				selectedTools: [],
				contextFiles: [],
				skills: [],
				cwd: process.cwd(),
			});

			expect(prompt).toContain("Show file paths clearly");
		});
	});

	describe("default tools", () => {
		test("includes all default tools when snippets are provided", () => {
			const prompt = buildSystemPrompt({
				toolSnippets: {
					read: "Read file contents",
					bash: "Execute bash commands",
					edit: "Make surgical edits",
					write: "Create or overwrite files",
				},
				contextFiles: [],
				skills: [],
				cwd: process.cwd(),
			});

			expect(prompt).toContain("- read:");
			expect(prompt).toContain("- bash:");
			expect(prompt).toContain("- edit:");
			expect(prompt).toContain("- write:");
		});

		test("uses the kos product identity and deterministic validation contract", () => {
			const prompt = buildSystemPrompt({
				contextFiles: [],
				skills: [],
				cwd: process.cwd(),
			});

			expect(prompt).toContain("You are kos-agent");
			expect(prompt).toContain("Deterministic validation feedback is authoritative");
			expect(prompt).not.toContain("operating inside pi");
		});
	});

	describe("custom tool snippets", () => {
		test("includes custom tools in available tools section when promptSnippet is provided", () => {
			const prompt = buildSystemPrompt({
				selectedTools: ["read", "dynamic_tool"],
				toolSnippets: {
					dynamic_tool: "Run dynamic test behavior",
				},
				contextFiles: [],
				skills: [],
				cwd: process.cwd(),
			});

			expect(prompt).toContain("- dynamic_tool: Run dynamic test behavior");
		});

		test("omits custom tools from available tools section when promptSnippet is not provided", () => {
			const prompt = buildSystemPrompt({
				selectedTools: ["read", "dynamic_tool"],
				contextFiles: [],
				skills: [],
				cwd: process.cwd(),
			});

			expect(prompt).not.toContain("dynamic_tool");
		});
	});

	describe("prompt guidelines", () => {
		test("appends promptGuidelines to default guidelines", () => {
			const prompt = buildSystemPrompt({
				selectedTools: ["read", "dynamic_tool"],
				promptGuidelines: ["Use dynamic_tool for project summaries."],
				contextFiles: [],
				skills: [],
				cwd: process.cwd(),
			});

			expect(prompt).toContain("- Use dynamic_tool for project summaries.");
		});

		test("deduplicates and trims promptGuidelines", () => {
			const prompt = buildSystemPrompt({
				selectedTools: ["read", "dynamic_tool"],
				promptGuidelines: ["Use dynamic_tool for summaries.", "  Use dynamic_tool for summaries.  ", "   "],
				contextFiles: [],
				skills: [],
				cwd: process.cwd(),
			});

			expect(prompt.match(/- Use dynamic_tool for summaries\./g)).toHaveLength(1);
		});
	});
});
