export interface StateMachine {
	field: "status" | "review_status" | "reviewed";
	edges: ReadonlyMap<string, readonly string[]>;
}

function chain(states: readonly string[], terminalAlternatives: readonly string[] = []): ReadonlyMap<string, readonly string[]> {
	const edges = new Map<string, readonly string[]>();
	for (let index = 0; index < states.length - 1; index++) {
		edges.set(states[index], [states[index + 1], ...terminalAlternatives]);
	}
	return edges;
}

const projectStates = ["idea", "active", "paused", "blocked", "completed", "archived", "cancelled"] as const;
const projectEdges = new Map<string, readonly string[]>();
for (const from of ["idea", "active", "paused", "blocked", "completed"]) {
	projectEdges.set(from, projectStates.filter((state) => state !== from));
}

export const STATE_MACHINES: Readonly<Record<string, StateMachine | undefined>> = {
	source: { field: "status", edges: chain(["captured", "extracted", "summarized", "reviewed", "linked", "archived"], ["ignored"]) },
	extract: { field: "review_status", edges: chain(["pending", "reviewed"]) },
	summary: { field: "reviewed", edges: chain(["false", "true"]) },
	research: { field: "status", edges: chain(["draft", "reviewed", "complete", "archived"]) },
	concept: { field: "status", edges: chain(["draft", "verified", "mature"]) },
	project: { field: "status", edges: projectEdges },
	task: {
		field: "status",
		edges: new Map([
			["todo", ["doing", "blocked", "cancelled"]],
			["doing", ["done", "blocked", "cancelled"]],
		]),
	},
	reflection: { field: "status", edges: chain(["raw", "developed", "archived"]) },
	personal_operating_profile: { field: "status", edges: chain(["draft", "reviewed", "active", "archived"]) },
	method: {
		field: "status",
		edges: new Map([
			["candidate", ["usable", "deprecated"]],
			["usable", ["trusted", "deprecated"]],
			["trusted", ["deprecated"]],
		]),
	},
};

export function legalTargets(type: string, current: string): readonly string[] {
	return STATE_MACHINES[type]?.edges.get(current) ?? [];
}
