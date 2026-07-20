# Pi upstream snapshot

`pi.json` identifies the exact Pi source snapshot imported into `agent/packages/`.

Imported package mapping:

- `packages/ai` -> `agent/packages/ai`
- `packages/agent` -> `agent/packages/agent`
- `packages/coding-agent` -> `agent/packages/kos-agent`

Initial local patches:

- Rename coding-agent to `@kos-framework/kos-agent`.
- Expose only the RPC entry as the `kos-agent` executable.
- Use `.kos-agent`, `KOS_AGENT_DIR`, and `KOS_AGENT_SESSION_DIR` for product state.
- Force RPC and project trust (YOLO) in the product entry.
- Resolve `pi-tui` from npm instead of vendoring its source.
- Generate and check in the Pi model catalog on 2026-07-20 because upstream git ignores the JSON catalog required by source-level tests.
- Keep that checked-in catalog stable during normal builds; model refresh remains an explicit command.
- Add an RPC-capable `ask_question` built-in by adapting Pi's bundled question/questionnaire examples from TUI-only custom UI to portable extension `select`/`input` calls.
- Split the required kos product/core tests from the retained full upstream suite; `npm run test:upstream` continues to expose branding, TUI, external binary, and non-hermetic upstream gaps.

Non-upstream runtime dependencies introduced by kos patches:

- `csv-parse@7.0.1` (MIT), used for structured Skill Eval CSV definition validation instead of a handwritten parser.

The original MIT license is preserved in `LICENSE.pi`. Upstream tests remain with each imported package.
