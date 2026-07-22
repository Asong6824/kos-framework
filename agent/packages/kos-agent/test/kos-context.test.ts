import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { loadProjectContextFiles } from "../src/core/resource-loader.ts";
import { loadSkills } from "../src/core/skills.ts";
import { buildSystemPrompt } from "../src/core/system-prompt.ts";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("kos runtime context", () => {
	it("loads .kos.md and Vault Skills into the product prompt", () => {
		const root = mkdtempSync(join(tmpdir(), "kos-context-"));
		roots.push(root);
		const agentDir = join(root, ".config");
		mkdirSync(agentDir, { recursive: true });
		writeFileSync(join(root, ".kos.md"), "# kos runtime rules");
		const skillDir = join(root, "80_Skills", "core", "test-skill");
		mkdirSync(skillDir, { recursive: true });
		writeFileSync(join(skillDir, "SKILL.md"), `---\nname: test-skill\ndescription: Test kos skill\n---\nRun the workflow.`);

		const contextFiles = loadProjectContextFiles({ cwd: root, agentDir });
		const skills = loadSkills({ cwd: root, agentDir, skillPaths: [], includeDefaults: true }).skills;
		const prompt = buildSystemPrompt({ cwd: root, contextFiles, skills });

		expect(contextFiles).toContainEqual({ path: join(root, ".kos.md"), content: "# kos runtime rules" });
		expect(skills.some((skill) => skill.name === "test-skill")).toBe(true);
		expect(prompt).toContain("You are kos-agent");
		expect(prompt).toContain("# kos runtime rules");
		expect(prompt).toContain("<name>test-skill</name>");
	});
});
