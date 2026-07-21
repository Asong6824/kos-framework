# CLAUDE.md

This is the Claude Code adapter for a kos vault.

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
kos-harness validate
kos-harness daily-dashboard
kos-harness daily-brief
kos-harness diary
```

## Skill Handling

`41_Skills/` stores kos Skills: agent-readable procedures for operating the vault. Some metadata remains Hermes-compatible for users who run Hermes Agent, but Claude Code should treat the files as kos procedures and follow the object rules plus harness checks.
