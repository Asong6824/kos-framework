import type { TextContent } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "../core/extensions/types.ts";
import { findVaultRoot, formatValidationSummary, validateChangedFiles } from "../kos/validation/validate.ts";
import { validateSkillEvals } from "../kos/validation/skill-evals.ts";
import { validateSkillFiles } from "../kos/validation/skills.ts";

function mergeDetails(details: unknown, validation: ReturnType<typeof validateChangedFiles>): Record<string, unknown> {
	return details && typeof details === "object" && !Array.isArray(details)
		? { ...details, validation }
		: { validation };
}

export default function kosValidationExtension(pi: ExtensionAPI): void {
	pi.on("tool_result", async (event, ctx) => {
		if (event.isError || (event.toolName !== "edit" && event.toolName !== "write")) return undefined;
		const path = event.input.path ?? event.input.file_path;
		if (typeof path !== "string") return undefined;
		const root = findVaultRoot(ctx.cwd);
		if (!root) return undefined;

		const normalizedPath = path.replaceAll("\\", "/");
		const validation = normalizedPath.endsWith("/SKILL.md")
			? validateSkillFiles(root, [path])
			: normalizedPath.includes("/90_系统/evals/") || normalizedPath.startsWith("90_系统/evals/")
				? validateSkillEvals(root)
				: path.endsWith(".md")
					? validateChangedFiles(root, [path])
					: undefined;
		if (!validation) return undefined;
		if (validation.validatedPaths.length === 0) return undefined;
		const summary: TextContent = { type: "text", text: formatValidationSummary(validation) };
		return {
			content: [...event.content, summary],
			details: mergeDetails(event.details, validation),
			isError: !validation.passed,
		};
	});
}
