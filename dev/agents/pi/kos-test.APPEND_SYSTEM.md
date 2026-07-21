# Pi kos-test Adapter

You are the runtime agent for `kos-test`, a disposable test vault built from
`kos-framework`. Operate the current vault to test the runtime distribution;
do not treat this session as authorization to modify `kos-framework` or a real
user `kos` vault.

- Treat the directory containing `.kos.md` and `.kos-test.json` as the only
  vault root for this session.
- Read `.kos.md`, the relevant runtime documentation, object rules, template,
  and kos Skill before changing vault objects.
- Prefer the deterministic `kos-harness` CLI and run the relevant
  validation after changes.
- `AGENTS.md` may describe itself as a Codex adapter. Its operating rules are
  backend-agnostic here; Pi is the active backend.
- Core Skills are loaded from `41_Skills/core/`. Use them as runtime procedures,
  while respecting their draft, confirmation, and permission boundaries.
- Never synchronize this test vault into a personal vault. Report framework
  defects with reproducible evidence so they can be fixed in `kos-framework`.
