# kos-agent

`agent/` 用于设计和实现 kos 官方 Agent。本文档统一采用以下定义：

```text
Agent = LLM + Harness
```

LLM 是被调用的模型。Harness 是除 LLM 本身以外、让模型成为可用 Agent 的全部工程系统，包括模型接入、Agent loop、上下文、工具、Skill、状态、会话、权限、UI、编排、可观测性、验证、Eval 和反馈循环。

kos-agent 是由“可替换 LLM + kos Harness”组成的完整 Agent。实现上不从空目录重写，而是把 Pi 的 `pi-ai`、`pi-agent-core` 和 `pi-coding-agent` 源码与测试复制进来，以 `pi-coding-agent` 为代码基线改造成 kos-agent。

当前版本已形成可安装闭环：固定 Pi revision 的三层源码、强制 RPC + YOLO、完整 TypeScript Runtime Harness、`.kos.md`/Vault Skills、Task/Skill Eval、对象与日常工作流、Obsidian 对话与高级 session、富上下文、安全 Web 工具、结构化验证反馈和单文件 host 发布包。

## 核心定位

- `pi-ai`、`pi-agent-core` 和 `pi-coding-agent` 采用源码 vendor/fork，而不是只把 coding-agent 当参考。
- 默认继承 Pi 已有的模型接入、Agent loop、session、compaction、资源加载、Skills、工具、extension 和 headless 能力，再做 kos 定制。
- kos-agent 只有 YOLO 一种执行模式，不实现 plan mode、权限模式切换或逐工具审批。
- kos-agent 可以自主修改对象状态；人工审阅不是强制门禁。`ask_question` 可以把审阅挂在对话中，用户回答后 Agent 再更新状态。
- Obsidian kos Companion、kos-agent runtime、Vault 上下文和系统反馈共同组成完整 Harness。
- 使用体验以 Claude Code 和 Claudian 为参照：对话、流式输出、工具卡片、上下文引用、会话恢复、diff、inline edit 和模型选择应保持熟悉且低摩擦。
- Obsidian 启动独立 kos-agent 子进程，并通过扩展后的 Pi RPC 通信。
- 缺失能力先调研 Pi examples/packages、Claudian、provider SDK 和成熟社区库，确认没有合适实现后才自研；不建设 MCP 能力。
- LLM provider 和具体模型可以更换，但 kos-agent 的产品行为由 kos Harness 定义。
- kos 不再以“同等兼容多种现成 Agent 产品”为目标；官方体验只围绕 kos-agent 建设。
- Hermes、Codex、Claude Code 等仍可读取 Markdown Vault，但不属于官方 Harness 的实现目标。
- Vault 中的 Markdown 内容、对象规范、模板和用户 Skill 保持可读、可导出，不成为 kos-agent 私有数据。

## 文档

- [docs/00_Agent与Harness基础.md](docs/00_Agent与Harness基础.md)：Agent、Harness、Harness Engineering 和 Pi 包分层的基础定义。
- [docs/01_定位与边界.md](docs/01_定位与边界.md)：kos-agent 的职责、强绑定范围和开放边界。
- [docs/02_总体架构.md](docs/02_总体架构.md)：LLM 与 Harness 的组成、运行循环、插件协议和存储边界。
- [docs/03_Pi工具与扩展设计.md](docs/03_Pi工具与扩展设计.md)：Pi 包职责、kos-agent 自有能力和首版工具面。
- [docs/04_权限与交互协议.md](docs/04_权限与交互协议.md)：唯一 YOLO 执行路径、`ask_question`、透明度和失败策略。
- [docs/05_强绑定与开放边界.md](docs/05_强绑定与开放边界.md)：产品强绑定决策、可移植性底线与迁移方向。
- [docs/06_产品体验与社区复用.md](docs/06_产品体验与社区复用.md)：Claude Code/Claudian 体验基线、社区调研和引入规则。
- [docs/07_Vault能力迁移计划.md](docs/07_Vault能力迁移计划.md)：现有 runtime scripts、schemas、Validator 和插件重复逻辑迁入 agent 的边界与顺序。

## 目录约束

- 不在 `agent/` 中复制对象规范；Harness 消费并执行 Vault 中的声明式契约。
- 不提交模型密钥、用户会话、原始 Agent trace 或个人 Vault 内容。
- 不为 Hermes、Codex、Claude Code 建立与 kos-agent 同等的 Harness 适配。
- Obsidian 插件只依赖版本化的 kos-agent 接口；该接口优先从 vendored `pi-coding-agent` 的 RPC/SDK 演进，不另起一套重复实现。
- 复制或改造 Pi、Claudian 与社区代码时保留许可证、上游版本和变更记录。
- Runtime 可执行逻辑和 machine schema 只位于 kos-agent；Vault 不分发 Python Harness。
- kos-agent 的测试夹具和开发评估属于 `dev/`，不进入用户 Vault。

## 当前实现基线

- 上游快照与许可证：`upstream/pi.json`、`upstream/LICENSE.pi`、`upstream/README.md`。
- 产品入口：`packages/kos-agent/src/rpc-entry.ts`，调用者不能切回 TUI/text mode 或关闭 YOLO。
- 默认产品工具：Pi 文件/命令工具、从 Pi question examples 改造的 RPC-capable `ask_question`，以及基于社区实现适配的 `web_search`/`web_fetch`。
- 测试：`npm run check` 运行三包构建、`pi-agent-core` 全套测试和 kos 核心产品测试；`npm run test:upstream` 单独跟踪尚未完成品牌/环境适配的完整 coding-agent 套件。
- 真实模型冒烟：显式提供临时 provider 配置后运行 `npm run test:live`，该脚本不保存或输出密钥。
- MVP 发布包：`make mvp-package` 生成 `release/kos-companion/`；插件自动发现内置 host，运行环境要求 Node.js 22.19+。
