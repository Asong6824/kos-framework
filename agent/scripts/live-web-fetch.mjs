import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RpcClient } from "../packages/kos-agent/dist/modes/rpc/rpc-client.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const provider = process.env.KOS_LIVE_PROVIDER;
const model = process.env.KOS_LIVE_MODEL;
const cliPath = process.env.KOS_LIVE_CLI_PATH ?? join(root, "packages/kos-agent/dist/rpc-entry.js");
const fetchUrl = process.env.KOS_LIVE_FETCH_URL ?? "https://example.com/";
const expectedContent = process.env.KOS_LIVE_EXPECT_CONTENT;
if (!provider || !model || !process.env.KOS_AGENT_DIR) {
	throw new Error("KOS_LIVE_PROVIDER, KOS_LIVE_MODEL, and KOS_AGENT_DIR are required");
}

const sessionDir = await mkdtemp(join(tmpdir(), "kos-agent-live-web-"));
const client = new RpcClient({
	cliPath,
	cwd: join(root, ".."),
	provider,
	model,
	env: {
		KOS_AGENT_DIR: process.env.KOS_AGENT_DIR,
		KOS_AGENT_SESSION_DIR: sessionDir,
		PI_SKIP_VERSION_CHECK: "1",
	},
});

try {
	await client.start();
	const events = await client.promptAndWait(
		`Call web_fetch exactly once for ${fetchUrl}. Then reply with the fetched title and no other facts.`,
		undefined,
		120_000,
	);
	const toolEnd = events.find((event) => event.type === "tool_execution_end" && event.toolName === "web_fetch");
	if (!toolEnd || toolEnd.type !== "tool_execution_end" || toolEnd.isError) {
		throw new Error("The model did not complete web_fetch successfully");
	}
	const toolText = Array.isArray(toolEnd.result.content)
		? toolEnd.result.content.filter((block) => block.type === "text").map((block) => block.text).join("")
		: "";
	const fetchedTitle = toolEnd.result.details?.title;
	if (!toolText.includes("kos_untrusted_external_content") || typeof fetchedTitle !== "string" || !fetchedTitle.trim()) {
		throw new Error(
			`web_fetch assertion failed (boundary=${toolText.includes("kos_untrusted_external_content")}, title=${typeof fetchedTitle === "string" && !!fetchedTitle.trim()}, length=${toolText.length})`,
		);
	}
	if (expectedContent && !toolText.includes(expectedContent)) {
		throw new Error("web_fetch result did not contain the expected public test content");
	}
	const assistant = events
		.filter((event) => event.type === "message_end" && event.message.role === "assistant")
		.flatMap((event) => event.type === "message_end" && Array.isArray(event.message.content)
			? event.message.content.filter((block) => block.type === "text").map((block) => block.text)
			: [])
		.at(-1);
	if (!assistant?.trim()) throw new Error("The model returned no final Web answer");
	console.log(`live web_fetch passed: ${provider}/${model}`);
} finally {
	await client.stop();
	await rm(sessionDir, { recursive: true, force: true });
}
