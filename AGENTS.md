# kos-framework Agent Instructions

## Repository Boundaries

- `vault/` is the runtime distribution delivered to kos users.
- `dev/` contains framework development harness, development Skills, release evals, and distribution specifications.
- `local-docs/` is private and ignored by Git when present.
- Runtime user documentation belongs under `vault/90_系统/文档/`.
- Development documentation and design reasoning belong under `local-docs/`.

Never place framework development tooling under `vault/`.

## Validation

Runtime correctness is checked by `vault/90_系统/harness/`.

Framework source and release correctness is checked by `dev/harness/`, `dev/tests/`, CI, and the Makefile.

Runtime Skills must not be used as the sole validator of changes to themselves.

## Change Flow

1. Classify a requirement as runtime core, integration, personal, or framework development.
2. Record private reasoning in `local-docs/` when available.
3. Change the correct layer.
4. Add the corresponding runtime or development eval.
5. Run `make release-check` before downstream synchronization or release.
