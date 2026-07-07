---
name: kos-framework-release
description: Prepare and validate a kos-framework release without leaking development assets or private content into the runtime vault.
version: 0.1.0
metadata:
  development:
    scope: framework
    published_to_runtime: false
---
# kos-framework-release

## When to Use

Use before tagging or publishing a kos-framework version.

## Procedure

1. Confirm `VERSION`, `pyproject.toml`, changelog, distribution manifest, and vault framework version agree.
2. Run all runtime and development checks.
3. Initialize a clean vault and run its health report.
4. Run sensitive-content scanning.
5. Confirm `dev/` and `local-docs/` are absent from the runtime distribution.

## Verification

The release is ready only when `make release-check` passes.
