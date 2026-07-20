import { describe, expect, it } from "vitest";
import { APP_NAME, CONFIG_DIR_NAME, ENV_AGENT_DIR, ENV_SESSION_DIR, PACKAGE_NAME } from "../src/config.ts";
import { buildKosRpcArgs } from "../src/kos/rpc-args.ts";

describe("kos product baseline", () => {
	it("uses kos product identity and storage paths", () => {
		expect(APP_NAME).toBe("kos-agent");
		expect(PACKAGE_NAME).toBe("@kos-framework/kos-agent");
		expect(CONFIG_DIR_NAME).toBe(".kos-agent");
		expect(ENV_AGENT_DIR).toBe("KOS_AGENT_DIR");
		expect(ENV_SESSION_DIR).toBe("KOS_AGENT_SESSION_DIR");
	});

	it("forces RPC and YOLO regardless of caller mode flags", () => {
		expect(buildKosRpcArgs(["--mode", "text", "--no-approve", "--model", "test/model"])).toEqual([
			"--mode",
			"rpc",
			"--model",
			"test/model",
			"--approve",
		]);
	});
});
