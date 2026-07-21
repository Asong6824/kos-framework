import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RpcClient } from "../packages/kos-agent/dist/modes/rpc/rpc-client.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const provider = process.env.KOS_LIVE_PROVIDER;
const model = process.env.KOS_LIVE_MODEL;
const cliPath = process.env.KOS_LIVE_CLI_PATH ?? join(root, "packages/kos-agent/dist/rpc-entry.js");
if (!provider || !model || !process.env.KOS_AGENT_DIR) {
	throw new Error("KOS_LIVE_PROVIDER, KOS_LIVE_MODEL, and KOS_AGENT_DIR are required");
}

const sessionDir = await mkdtemp(join(tmpdir(), "kos-agent-live-search-"));
const client = new RpcClient({
	cliPath,
	cwd: join(root, ".."),
	provider,
	model,
	env: {
		KOS_AGENT_DIR: process.env.KOS_AGENT_DIR,
		KOS_AGENT_SESSION_DIR: sessionDir,
		KOS_WEB_SEARCH_PROVIDER: "model",
		PI_SKIP_VERSION_CHECK: "1",
	},
});

try {
	await client.start();
	const events = await client.promptAndWait(
		"Call web_search exactly once to find the official title of example.com. Then answer in one sentence.",
		undefined,
		180_000,
	);
	const toolEnd = events.find((event) => event.type === "tool_execution_end" && event.toolName === "web_search");
	if (!toolEnd || toolEnd.type !== "tool_execution_end" || toolEnd.isError) {
		throw new Error("The model did not complete web_search successfully");
	}
	const toolText = Array.isArray(toolEnd.result.content)
		? toolEnd.result.content.filter((block) => block.type === "text").map((block) => block.text).join("")
		: "";
	const details = toolEnd.result.details;
	const resultCount = Array.isArray(details?.results) ? details.results.length : 0;
	if (!toolText.includes("kos_untrusted_external_content") || details?.provider !== "model" || resultCount < 1) {
		throw new Error(
			`web_search assertion failed (boundary=${toolText.includes("kos_untrusted_external_content")}, provider=${String(details?.provider)}, results=${resultCount})`,
		);
	}
	console.log(`live web_search passed: ${provider}/${model}, results=${resultCount}`);
} finally {
	await client.stop();
	await rm(sessionDir, { recursive: true, force: true });
}
