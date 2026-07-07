# Contributing

## Scope

This repository accepts reusable core framework changes only.

Do not add:

- Personal notes or projects.
- Private paths, credentials, or profile configuration.
- Personal or platform-specific Skills under `vault/41_Skills/core/`.

## Development Flow

1. Create or reproduce the need in a personal kos vault.
2. Decide whether it is core, integration, or personal.
3. Add only reusable core behavior to this repository.
4. Add or update a Skill eval case.
5. Run `make release-check`.
6. Test initialization with `make test-init`.

## Core Skill Requirements

- `metadata.kos.scope: core`
- `metadata.hermes.pinned: true`
- Standard Skill sections.
- Contract eval coverage.
- Human review before release.
