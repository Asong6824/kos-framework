# kos-framework Agent Instructions

## Repository Boundaries

- `vault/` is the runtime distribution delivered to kos users.
- `dev/` contains framework development harness, development Skills, release evals, distribution specifications, and development documentation.
- `ob-plugin/` contains the Obsidian plugin project (source, docs, tests), which consumes the vault object spec as a read-only contract and stays out of the framework distribution.
- Runtime user documentation belongs under `vault/90_系统/文档/`.
- Development documentation and design reasoning belong under `dev/docs/`.
- Obsidian plugin documentation belongs under `ob-plugin/docs/`.

Never place framework development tooling under `vault/`.

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
