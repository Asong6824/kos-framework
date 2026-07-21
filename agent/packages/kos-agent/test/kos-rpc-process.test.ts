import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const packageDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const entryPath = join(packageDir, "dist", "rpc-entry.js");
const tempDirs: string[] = [];

afterEach(async () => {
	await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("kos-agent RPC process", () => {
	it("starts the product entry, answers get_state, and uses isolated kos paths", async () => {
		const root = await mkdtemp(join(tmpdir(), "kos-agent-rpc-"));
		tempDirs.push(root);
		const configDir = join(root, "config");
		const sessionDir = join(root, "sessions");

		const child = spawn(process.execPath, [entryPath, "--continue", "--mode", "text", "--no-approve"], {
			cwd: root,
			env: {
				...process.env,
				KOS_AGENT_DIR: configDir,
				KOS_AGENT_SESSION_DIR: sessionDir,
			},
			stdio: ["pipe", "pipe", "pipe"],
		});

		let stderr = "";
		child.stderr.setEncoding("utf8");
		child.stderr.on("data", (chunk: string) => {
			stderr += chunk;
		});

		try {
			const readResponse = (expectedId: string): Promise<Record<string, unknown>> =>
				new Promise<Record<string, unknown>>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error(`RPC startup timed out: ${stderr}`)), 10_000);
				let buffer = "";

				child.once("error", reject);
				child.stdout.setEncoding("utf8");
				const onData = (chunk: string) => {
					buffer += chunk;
					for (const line of buffer.split("\n")) {
						if (!line) continue;
						const parsed = JSON.parse(line) as { id?: string };
						if (parsed.id !== expectedId) continue;
						clearTimeout(timeout);
						child.stdout.off("data", onData);
						resolve(parsed as Record<string, unknown>);
						return;
					}
				};
				child.stdout.on("data", onData);
			});

			const responsePromise = readResponse("smoke-1");
				child.stdin.write(`${JSON.stringify({ id: "smoke-1", type: "get_state" })}\n`);
			const response = await responsePromise;

			expect(response).toMatchObject({
				id: "smoke-1",
				type: "response",
				command: "get_state",
				success: true,
			});
			const data = response.data as { sessionFile?: string; sessionId?: string; isStreaming?: boolean };
			expect(data.isStreaming).toBe(false);
			expect(data.sessionId).toBeTruthy();
			expect(data.sessionFile).toMatch(new RegExp(`^${sessionDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));

			const bashPromise = readResponse("smoke-2");
			child.stdin.write(`${JSON.stringify({ id: "smoke-2", type: "bash", command: "echo kos-agent-smoke" })}\n`);
			await expect(bashPromise).resolves.toMatchObject({
				id: "smoke-2",
				type: "response",
				command: "bash",
				success: true,
				data: { output: "kos-agent-smoke\n", exitCode: 0 },
			});

			const validationPromise = readResponse("smoke-3");
			child.stdin.write(`${JSON.stringify({ id: "smoke-3", type: "validate" })}\n`);
			await expect(validationPromise).resolves.toMatchObject({
				id: "smoke-3",
				type: "response",
				command: "validate",
				success: true,
				data: { passed: false },
			});

			const searchKey = ["test", "search", "credential"].join("-");
			const configureSearchPromise = readResponse("smoke-4");
			child.stdin.write(`${JSON.stringify({
				id: "smoke-4",
				type: "configure_web_search",
				provider: "brave",
				apiKey: searchKey,
			})}\n`);
			await expect(configureSearchPromise).resolves.toMatchObject({
				command: "configure_web_search",
				success: true,
				data: { provider: "brave" },
			});

			const searchStatePromise = readResponse("smoke-5");
			child.stdin.write(`${JSON.stringify({ id: "smoke-5", type: "get_web_search_state" })}\n`);
			await expect(searchStatePromise).resolves.toMatchObject({
				command: "get_web_search_state",
				success: true,
				data: { brave: true, exa: false },
			});
			const authPath = join(configDir, "auth.json");
			expect((await stat(authPath)).mode & 0o777).toBe(0o600);
			expect(await readFile(authPath, "utf8")).toContain(searchKey);
		} finally {
			child.stdin.end();
			if (child.exitCode === null) child.kill("SIGTERM");
		}
	}, 15_000);
});
