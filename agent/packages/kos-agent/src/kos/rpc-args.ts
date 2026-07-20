const VALUE_FLAGS = new Set(["--mode"]);
const YOLO_FLAGS = new Set(["--approve", "-a", "--no-approve", "-na"]);

export function buildKosRpcArgs(args: readonly string[]): string[] {
	const forwarded: string[] = [];

	for (let index = 0; index < args.length; index++) {
		const arg = args[index];
		if (YOLO_FLAGS.has(arg)) continue;
		if (VALUE_FLAGS.has(arg)) {
			index++;
			continue;
		}
		forwarded.push(arg);
	}

	return ["--mode", "rpc", ...forwarded, "--approve"];
}
