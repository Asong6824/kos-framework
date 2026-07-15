# kos-framework

kos-framework is a reusable core framework for building a Markdown-vault-based personal knowledge operating system.

It provides:

- A vault directory structure.
- A typed object model for sources, extracts, summaries, research, concepts, projects, tasks, diaries, reflections, methods, and signals.
- Core kos Skills for operating the vault.
- Harness scripts for validation and object creation.
- Skill evals to prevent skill behavior drift.
- User documentation inside the runtime vault.

This repository contains only the core framework. Personal notes, private integrations, and personal workflows are intentionally excluded.

## How To Consume This Repository

`kos-framework` is the source repository for the framework. The `vault/` directory is the runtime distribution that gets copied into a user's own kos workspace.

Users should not keep personal notes directly in `kos-framework/vault/`. Instead, clone this repository, initialize a separate kos vault from `vault/`, and do day-to-day work in that separate vault.

```text
kos-framework/        # source repo: framework, tests, release tooling
  vault/              # runtime template copied to users
  dev/                # framework development only

~/kos/                # user's actual personal kos workspace
  00_工作台/
  10_收件箱/
  41_Skills/
  90_系统/
```

This keeps the framework maintainable while still letting users consume only the runtime vault content. A future release process can publish `vault/` as a generated archive or template mirror, but this repository remains the authoritative project because the runtime, harness, evals, and release checks need to evolve together.

## Quick Start

Create a new vault:

```bash
python3 dev/harness/init_vault.py ~/kos
```

Run the health check:

```bash
cd ~/kos
python3 90_系统/harness/generate_health_report.py
```

Use an agent backend.

For Hermes:

```yaml
terminal:
  cwd: /path/to/your/kos

skills:
  external_dirs:
    - /path/to/your/kos/41_Skills
```

Then use:

```text
/kos-system-check
/kos-start-my-day
/kos-ingest
/kos-research
/kos-create-project
```

For Codex or Claude Code, open the vault directory and let the agent read:

```text
.kos.md
AGENTS.md or CLAUDE.md
90_系统/规则/对象规范.md
```

## Repository Layout

```text
vault/                 # Runtime distribution copied to users
dev/                   # Framework development harness, Skills, docs, evals, and tests
```

Inside `vault/`:

```text
41_Skills/core/        # Core kos Skills
90_系统/规则/           # Object rules
90_系统/模板/           # Object templates
90_系统/harness/        # Validation and creation scripts
90_系统/evals/          # Skill eval definitions
90_系统/文档/           # In-vault usage docs
```

## Documentation

Documentation has two layers:

- Runtime user documentation ships with the vault under `vault/90_系统/文档/`.
- Framework development documentation lives under `dev/docs/` and is not copied into runtime vaults.

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
- Harness and eval infrastructure.

Excluded:

- Personal vault content.
- Optional external integrations.
- Personal writing or translation workflows.
- Private local configuration.
