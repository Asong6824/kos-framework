---
name: kos-framework-maintainer
description: Maintain kos-framework source, preserve runtime/development boundaries, and synchronize validated core changes to downstream personal vaults.
version: 0.1.0
metadata:
  development:
    scope: framework
    published_to_runtime: false
---
# kos-framework-maintainer

## When to Use

Use when changing framework core Skills, runtime harness, schemas, templates, distribution structure, or downstream synchronization.

## Rules

- Treat `vault/` as the runtime distribution.
- Treat `dev/` as framework development infrastructure.
- Never copy `dev/skills` or `dev/harness` into a user vault.
- Run development validation before synchronizing downstream.
- Preserve personal and integration files in downstream vaults.

## Verification

Run `make check`, `make dev-check`, `make test`, `make test-init`, and `make scan`.
