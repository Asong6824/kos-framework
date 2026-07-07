# Agent 后端

kos 最初按 Hermes Agent + Obsidian 的组合设计，但框架本身不应绑定某一个 agent 后端。

更准确的分层是：

| 层 | 作用 | 是否绑定后端 |
|---|---|---|
| Obsidian / Markdown 编辑器 | 前端展示、人工阅读、手动编辑 | 否 |
| Markdown vault | 唯一真相源 | 否 |
| 对象规范与模板 | 约束 frontmatter、状态、路径和正文结构 | 否 |
| Harness | 确定性创建、校验、报告和评估 | 否 |
| kos Skill | Agent 可读的操作流程 | 尽量不绑定 |
| Agent adapter | 让具体 agent 理解 kos | 是 |

## 通用根标记

`.kos.md` 是 kos vault 的通用根标记。

Agent、脚本和人工操作都应把包含 `.kos.md` 的目录视为 vault 根目录。历史 Hermes 环境仍兼容 `.hermes.md`，但新的跨后端能力应优先依赖 `.kos.md`。

## 支持的后端入口

| 文件 | 面向对象 | 作用 |
|---|---|---|
| `.kos.md` | 所有 agent 和人工维护者 | 通用 kos 上下文和根规则 |
| `.hermes.md` | Hermes Agent | Hermes 专用运行入口 |
| `AGENTS.md` | Codex | Codex 专用运行入口 |
| `CLAUDE.md` | Claude Code | Claude Code 专用运行入口 |

这些文件不应该各自定义一套对象规则。对象规则只能以 `90_系统/规则/对象规范.md`、模板和 harness 为准。

## Hermes Agent

Hermes 适合长期固定运行 kos，因为它可以通过 Skill 和 profile 建立稳定触发方式。

典型配置：

```yaml
terminal:
  cwd: /path/to/your/kos

skills:
  external_dirs:
    - /path/to/your/kos/41_Skills
```

Hermes 用户可以继续使用 `/kos-*` 命令，例如：

```text
/kos-system-check
/kos-start-my-day
/kos-ingest
/kos-research
/kos-create-project
```

## Codex

Codex 适合用来维护 kos vault、修改 framework、运行 harness、排查结构问题和执行较明确的批量操作。

使用方式：

1. 在 Codex 中打开 kos vault 目录。
2. 让 Codex 读取 `AGENTS.md`、`.kos.md` 和相关用户文档。
3. 要求它优先使用 `90_系统/harness/` 中的脚本。
4. 修改后运行健康检查。

常用命令：

```bash
python3 90_系统/harness/generate_health_report.py
```

Codex 不需要 Hermes profile，也不应该把 `.hermes.md` 当作唯一根标记。

## Claude Code

Claude Code 的定位与 Codex 类似：它可以直接在 vault 目录中读写文件、运行 harness、根据文档执行 kos workflow。

使用方式：

1. 在 Claude Code 中打开 kos vault 目录。
2. 让 Claude Code 读取 `CLAUDE.md`、`.kos.md` 和相关用户文档。
3. 对创建、检查和批量修复任务，优先调用 harness。
4. 修改后运行健康检查。

Claude Code 也不需要 Hermes profile。

## Skill 如何跨后端使用

`41_Skills/` 中的 Skill 是 kos 的能力层。它们应该描述：

- 什么时候使用。
- 需要读取哪些规则和模板。
- 如何判断 vault 根目录。
- 应调用哪些 harness。
- 哪些状态必须由用户确认。
- 输出格式和检查方式。

Skill 中保留 `metadata.hermes` 是为了兼容 Hermes 的 pinned、tag 和 profile 机制。跨后端治理应以 `metadata.kos` 为准。

## 维护原则

- 不为 Hermes、Codex、Claude Code 复制三套 Skill。
- 不在 adapter 文件里重新发明对象规范。
- 通用规则写入 `.kos.md`、对象规范、模板、harness 和用户文档。
- 后端差异只写入 `.hermes.md`、`AGENTS.md`、`CLAUDE.md`。
- 如果某个 workflow 在不同后端表现不一致，应补 Skill eval 或 harness 检查，而不是靠口头约定。
