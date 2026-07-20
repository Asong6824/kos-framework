import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RpcClient } from "../packages/kos-agent/dist/modes/rpc/rpc-client.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const provider = process.env.KOS_LIVE_PROVIDER;
const model = process.env.KOS_LIVE_MODEL;

if (!provider || !model || !process.env.KOS_AGENT_DIR) {
	throw new Error("KOS_LIVE_PROVIDER, KOS_LIVE_MODEL, and KOS_AGENT_DIR are required");
}

const sessionDir = await mkdtemp(join(tmpdir(), "kos-agent-live-"));
const client = new RpcClient({
	cliPath: join(root, "packages/kos-agent/dist/rpc-entry.js"),
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
		"Reply with exactly KOS_RPC_OK and no other text. Do not call tools.",
		undefined,
		120_000,
	);
	const assistant = events
		.filter((event) => event.type === "message_end" && event.message.role === "assistant")
		.map((event) =>
			event.type === "message_end" && Array.isArray(event.message.content)
				? event.message.content
						.filter((block) => block.type === "text")
						.map((block) => (block.type === "text" ? block.text : ""))
						.join("")
				: "",
		)
		.at(-1);

	if (!assistant?.includes("KOS_RPC_OK")) {
		throw new Error(`Unexpected live response: ${assistant ?? "<none>"}`);
	}
	const state = await client.getState();
	console.log(`live RPC smoke passed: ${state.model?.provider}/${state.model?.id}, session=${state.sessionId}`);
} finally {
	await client.stop();
	await rm(sessionDir, { recursive: true, force: true });
}
