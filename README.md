# kos-framework

kos-framework is a reusable core framework for building a Markdown-vault-based personal knowledge operating system.

It provides:

- A vault directory structure.
- A typed object model for sources, extracts, summaries, research, concepts, projects, tasks, diaries, reflections, methods, and signals.
- Core kos Skills for operating the vault.
- The official kos-agent Harness for validation, object operations, sessions, tools, and Skills.
- The kos Companion Obsidian plugin for a six-section dashboard, Agent UI, and independent Reader.
- Skill evals to prevent skill behavior drift.
- User documentation inside the runtime vault.

This repository contains the reusable framework, official Agent, and Obsidian integration. Personal notes, private integrations, and personal workflows are intentionally excluded.

## How To Consume This Repository

`kos-framework` is the source repository for the framework. The `vault/` directory is the runtime distribution that gets copied into a user's own kos workspace.

Users should not keep personal notes directly in `kos-framework/vault/`. Instead, clone this repository, initialize a separate kos vault from `vault/`, and do day-to-day work in that separate vault.

```text
kos-framework/        # source repo: framework, tests, release tooling
  vault/              # runtime template copied to users
  dev/                # framework development only
  agent/              # official kos-agent source fork and Harness
  ob-plugin/          # kos Companion source, docs, and tests
  release/            # generated release artifacts; not authoritative source

~/kos/                # user's actual personal kos workspace
  00_工作台/
  10_收件箱/
  41_Skills/
  90_系统/
```

This keeps the framework maintainable while letting users consume the Vault runtime and kos Companion as separate release artifacts. `vault/` is the Markdown runtime distribution; `ob-plugin/` and `agent/` remain source-owned layers and are packaged together into the kos Companion release. This repository remains authoritative because the object contracts, Agent Harness, plugin integration, evals, and release checks need to evolve together.

Framework development can use a separate disposable `kos-test` vault driven by Pi:

```bash
make kos-test-build  # create or refresh ../kos-test
make kos-test        # launch Pi from the kos-test root
```

Use `make kos-test-reset` only when all test-vault artifacts should be discarded. The command refuses to rebuild a directory that lacks the framework-generated `.kos-test.json` safety marker. See `dev/docs/Pi驱动kos-test.md` for the layer boundaries and workflow.

Run checked-in Pi Process Evals against disposable test-vault fixtures:

```bash
make process-eval-validate  # contracts and schemas only; no model call
make process-eval           # real Pi traces and protocol evaluation
```

## Quick Start

Create a new vault:

```bash
python3 dev/harness/init_vault.py ~/kos
```

Build the kos Companion release from a development checkout:

```bash
make mvp-package
```

Install `release/kos-companion/` at `<Vault>/.obsidian/plugins/kos-companion`, enable it in Obsidian, and reload the plugin after replacing an existing build. Node.js 22.19+ is required for the desktop kos-agent process; the deterministic dashboard and Reader do not depend on a model call.

Open the kos dashboard from the ribbon or command palette. It renders Today, Action, Input, Knowledge, Review & Reflection, and System as one continuous page. Open the Agent sidebar, configure a provider and model, then run the system check there.

Common Agent requests include:

```text
/kos-system-check
/kos-start-my-day
/kos-ingest
/kos-research
/kos-create-project
```

kos-agent is the official product backend. Codex, Claude Code, Hermes, and other tools can still operate the open Markdown Vault by reading:

```text
.kos.md
AGENTS.md or CLAUDE.md
90_系统/规则/对象规范.md
```

## Repository Layout

```text
vault/                 # Runtime distribution copied to users
dev/                   # Framework development harness, Skills, docs, evals, and tests
agent/                 # Official kos-agent source fork, protocol, tests, and docs
ob-plugin/             # kos Companion plugin source, plugin docs, and Obsidian E2E tests
```

Inside `vault/`:

```text
41_Skills/core/        # Core kos Skills
90_系统/规则/           # Object rules
90_系统/模板/           # Object templates
90_系统/evals/          # User-owned Skill and Task eval definitions; engine ships with kos-agent
90_系统/文档/           # In-vault usage docs
```

## Documentation

Documentation follows the ownership boundary:

- Runtime user documentation ships with the vault under `vault/90_系统/文档/`.
- Framework development documentation lives under `dev/docs/` and is not copied into runtime vaults.
- Obsidian plugin specifications and implementation notes live under `ob-plugin/docs/`.
- kos-agent architecture and migration documents live under `agent/docs/`.

Start with:

- [vault/90_系统/文档/00_快速开始.md](vault/90_系统/文档/00_快速开始.md)
- [vault/90_系统/文档/10_目录结构.md](vault/90_系统/文档/10_目录结构.md)
- [vault/90_系统/文档/20_对象模型与模板.md](vault/90_系统/文档/20_对象模型与模板.md)
- [vault/90_系统/文档/21_对象生命周期.md](vault/90_系统/文档/21_对象生命周期.md)
- [vault/90_系统/文档/22_个人操作画像.md](vault/90_系统/文档/22_个人操作画像.md)
- [vault/90_系统/文档/23_项目与任务.md](vault/90_系统/文档/23_项目与任务.md)
- [vault/90_系统/文档/24_读书与阅读.md](vault/90_系统/文档/24_读书与阅读.md)
- [vault/90_系统/文档/30_Harness与系统检查.md](vault/90_系统/文档/30_Harness与系统检查.md)
- [vault/90_系统/文档/40_Skill管理与防腐.md](vault/90_系统/文档/40_Skill管理与防腐.md)
- [vault/90_系统/文档/41_Skill Eval与防腐.md](vault/90_系统/文档/41_Skill Eval与防腐.md)
- [vault/90_系统/文档/50_扩展与个人化.md](vault/90_系统/文档/50_扩展与个人化.md)
- [vault/90_系统/文档/60_Framework同步.md](vault/90_系统/文档/60_Framework同步.md)
- [vault/90_系统/文档/70_Agent后端.md](vault/90_系统/文档/70_Agent后端.md)
- [vault/90_系统/文档/90_故障排查.md](vault/90_系统/文档/90_故障排查.md)

## Updating A Personal kos Vault

Preview framework changes:

```bash
python3 dev/harness/compare_vault.py /path/to/personal/kos
python3 dev/harness/sync_to_vault.py /path/to/personal/kos
```

Apply after reviewing the diff:

```bash
python3 dev/harness/sync_to_vault.py /path/to/personal/kos --apply
```

## Scope

Included:

- Core vault structure.
- Core object model.
- Core Skills.
- kos-agent Harness and eval infrastructure.
- kos Companion dashboard, Agent integration, and Reader.

Excluded:

- Personal vault content.
- Optional external integrations.
- Personal writing or translation workflows.
- Private local configuration.
