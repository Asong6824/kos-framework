# CLAUDE.md

This is the Claude Code adapter for a kos vault.

Use `.kos.md` as the shared vault context. The runtime rules, templates, and harness scripts are agent-backend agnostic; this file only tells Claude Code how to operate them.

## Operating Rules

- Work from the vault root, the directory containing `.kos.md`.
- Read `90_系统/规则/对象规范.md` before creating or changing kos objects.
- Prefer scripts in `90_系统/harness/` for creation, validation, reports, and dashboard generation.
- Keep object paths relative to the vault root.
- Preserve human-authored sections and existing frontmatter unless the requested change requires editing them.
- Use draft states for AI-generated judgment-heavy content.

## Common Commands

```bash
python3 90_系统/harness/generate_health_report.py
python3 90_系统/harness/validate_paths.py --format markdown
python3 90_系统/harness/validate_schema.py --format markdown
python3 90_系统/harness/validate_state.py --format markdown
python3 90_系统/harness/validate_permissions.py --format markdown
python3 90_系统/harness/validate_skills.py --format markdown
python3 90_系统/harness/validate_skill_evals.py --format markdown
```

## Skill Handling

`41_Skills/` stores kos Skills: agent-readable procedures for operating the vault. Some metadata remains Hermes-compatible for users who run Hermes Agent, but Claude Code should treat the files as kos procedures and follow the object rules plus harness checks.
