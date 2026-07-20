# kos-framework Agent Instructions

## Repository Boundaries

- `vault/` is the runtime distribution delivered to kos users.
- `dev/` contains framework development harness, development Skills, release evals, distribution specifications, and development documentation.
- `ob-plugin/` contains the Obsidian plugin project (source, docs, tests), which consumes the vault object spec as a read-only contract and stays out of the framework distribution.
- `agent/` contains the official kos-agent design and implementation. Its implementation starts from vendored copies of Pi's `pi-ai`, `pi-agent-core`, and `pi-coding-agent`, then modifies the coding-agent layer for kos; Vault data contracts remain readable and independent.
- Runtime user documentation belongs under `vault/90_系统/文档/`.
- Development documentation and design reasoning belong under `dev/docs/`.
- Obsidian plugin documentation belongs under `ob-plugin/docs/`.
- kos-agent documentation belongs under `agent/docs/`.

Never place framework development tooling under `vault/`.

## Agent Terminology

- In this repository, `Agent = LLM + Harness`.
- `Harness` means everything around the LLM that turns it into an effective agent: model access, agent loop, context construction, tools, Skills, prompts, state, sessions, permissions, UI, orchestration, observability, validation, evals, and feedback loops.
- Do not reimplement capabilities already present in the vendored Pi packages. Preserve the upstream license, source revision, tests, and a reviewable record of local changes.
- kos-agent is a source fork of `pi-coding-agent`, not a clean-room sibling implementation. Reuse its sessions, compaction, resources, tools, extension system, and headless interfaces before adding kos-specific behavior.
- kos-agent has one execution mode: YOLO. Do not add plan, permission, approval, or safe/strict mode switches. Tool calls run without per-call authorization prompts; `ask_question` is for missing information or business decisions, not permission.
- Import upstream `packages/coding-agent` as `agent/packages/kos-agent`; keep its TUI dependency initially for compatibility but do not expose a TUI product entry.
- Obsidian starts kos-agent as a child process and communicates over an extended Pi RPC protocol. Port the relevant Claudian chat/session/context/tool/diff/inline-edit modules instead of forking its multi-provider product shell.
- kos-agent does not support MCP. Before implementing a missing tool or UI capability, evaluate Pi built-ins/examples, maintained Pi packages, Claudian, provider SDKs, and other established libraries. Record provenance, license, version, maintenance, and security conclusions for adopted code.
- Runtime scripts and machine-enforced constraints currently under `vault/90_系统/harness/` are legacy migration sources. Their target implementation belongs in kos-agent; `dev/harness/` remains framework-development infrastructure.
- `vault/90_系统/harness/` is the current deterministic-script subset of the broader kos harness. Do not use that directory name to narrow the meaning of Harness Engineering.
- Do not model Harness as a separate peer runtime outside kos-agent. The kos-agent harness spans `agent/`, its Obsidian integration, and the system-controlled context and capabilities exposed from the Vault.

## Validation

Runtime correctness is checked by `vault/90_系统/harness/`.

Framework source and release correctness is checked by `dev/harness/`, `dev/tests/`, CI, and the Makefile.

Runtime Skills must not be used as the sole validator of changes to themselves.

## Change Flow

1. Classify a requirement as runtime core, integration, personal, or framework development.
2. Record framework development reasoning in `dev/docs/` when it is useful and safe to commit.
3. Change the correct layer.
4. Add the corresponding runtime or development eval.
5. Run `make release-check` before downstream synchronization or release.
