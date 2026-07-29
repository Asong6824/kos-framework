# Changelog

All notable changes to kos-framework are documented in this file.

## Unreleased

### Added

- Cross-platform one-command local installer for initializing a Vault, building and installing kos Companion, preserving settings, backing up upgrades, and validating the result.
- User-focused installation and update guide for release packages and source installs.
- CI verification of the documented install path, downloadable build artifacts, and automatic GitHub Release ZIP creation for `v*` tags.
- GitHub Releases include a ready-to-open Vault, a flat plugin archive for existing Vaults, and SHA-256 checksums.
- Release archives are built with portable UTF-8 filenames and self-check their install layout.
- CI performs a clean install followed by an upgrade and verifies settings, personal notes, receipts, and recoverable backups.
- Agent first-run checklist with model setup shortcuts, required-field validation, system check, and a ready-to-send first workflow.
- Hermetic real-Obsidian E2E coverage using an isolated local model endpoint and Agent config, including first-run model setup and the full daily recommendation flow.

### Fixed

- Task completion from the dashboard once again collects the actual result, outputs, and per-project contribution evidence before the Harness marks the task done.

## [0.1.0] - 2026-06-21

### Added

- Core kos vault structure.
- Eighteen core Hermes Skills.
- Object schemas, templates, and deterministic harness scripts.
- Skill contract evals with full core coverage.
- Vault initialization, comparison, and one-way synchronization tools.
