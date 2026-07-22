# AGENTS.md

This is the Codex adapter for a kos vault.

Use `.kos.md` as shared Vault context. kos-agent is the official Agent product and owns the executable Harness.

## Operating Rules

- Work from the vault root, the directory containing `.kos.md`.
- Read `90_系统/规则/对象规范.md` before creating or changing kos objects.
- Prefer `kos-harness` for deterministic creation, validation, Eval and daily workflows.
- Keep object paths relative to the vault root.
- Preserve human-authored sections and existing frontmatter unless the requested change requires editing them.
- Use draft states for AI-generated judgment-heavy content.

## Common Commands

```bash
node .obsidian/plugins/kos-companion/kos-agent/dist/kos-harness.mjs validate
node .obsidian/plugins/kos-companion/kos-agent/dist/kos-harness.mjs daily-dashboard
node .obsidian/plugins/kos-companion/kos-agent/dist/kos-harness.mjs daily-brief
node .obsidian/plugins/kos-companion/kos-agent/dist/kos-harness.mjs diary
```

## Skill Handling

`80_Skills/` stores kos-agent procedures. Follow their object rules and run the Harness checks; compatibility metadata is not an alternate runtime contract.
