# kos-agent 与外部 Agent

> 状态：kos-agent MVP 已可通过 kos Companion 安装使用。Runtime Validator、对象操作和 Eval 执行器已经从 Vault Python Harness 迁入 kos-agent；Vault 只保留规则、模板、Skills 和用户 Eval 定义。迁移记录见 framework 的 `agent/docs/07_Vault能力迁移计划.md`。

kos 的官方 Agent 后端是 kos-agent。Obsidian 对话、Context、Skill、工具、Session、Validator 和任务反馈都以 kos-agent 为产品基准，不再承诺 Hermes、Codex、Claude Code 等后端具有同等体验。

这不代表 Vault 被锁定：Markdown、对象规范、模板和 Skill 仍然可读，外部工具仍可以直接操作它们。

## 官方运行分层

| 层 | 作用 | 官方实现 |
|---|---|---|
| Obsidian kos Companion | 看板、对话、上下文引用、工具过程和 diff | kos 插件 |
| kos-agent Harness | Session、Context、Skills、Tools、YOLO 执行和反馈循环 | kos-agent |
| Pi 源码基线 | provider、Agent loop、session、compaction、tools 和 RPC/SDK | vendored Pi fork |
| Markdown Vault | 知识真相源 | 用户可直接访问 |
| 对象规范与 Validator | 结构和正确性契约 | Vault + kos-agent |

## YOLO 执行

kos-agent 只有 YOLO 一种执行模式。用户给出目标后，Agent 可以直接读取、创建、修改文件和运行命令，不会逐次弹出权限确认。

用户仍然可以：

- 查看每个工具调用、命令、diff、结果和错误。
- 随时 Stop。
- 在运行中发送 steering 或 follow-up。
- 在 Agent 缺少信息或需要业务判断时回答问题。

`ask_question` 用于信息和业务判断，不用于批准工具执行。使用 kos-agent 等于允许它使用宿主进程已经拥有的文件和命令能力。

Agent 可以自主修改对象状态，包括进入 `reviewed`、`complete`、`verified` 或 `mature`。人工审阅不是系统权限门禁；Agent 也可以在研究收尾后挂起一个审阅问题，等用户回答后再更新状态。

## 通用根标记

`.kos.md` 是 kos Vault 的通用根标记。kos-agent、脚本和人工操作都应把包含 `.kos.md` 的目录视为 Vault root。

历史 Hermes 环境仍兼容 `.hermes.md`，但新的 kos-agent 能力以 `.kos.md`、对象规范、模板和 Skills 为准。

## kos-agent 体验

官方体验位于同一个 Obsidian 插件中：

- 独立 Agent 对话视图。
- 当前文件、选区、图片、看板对象和 `@mention` context。
- Slash commands 和 kos Skills。
- 流式回答、thinking、工具卡片、diff 和 Validator。
- Session 新建、恢复、fork、tree 和 compact。
- Stop、steering 和 follow-up。
- 模型、context usage、tokens、cache 和费用。

交互以 Claude Code 和 Claudian 为参照，但后端始终是 kos-agent。

Obsidian Desktop 启动独立 kos-agent 子进程，并通过扩展后的 Pi RPC 通信。kos-agent 不支持 MCP。

Desktop 运行要求 Node.js 22.19+。插件安装包内含 kos-agent host，会自动从 PATH、Homebrew、Volta 等常见位置发现 Node；自动发现失败时在 kos Companion 设置中填写 Node 可执行文件路径。模型 provider、model ID、API key 和可选中转地址在 Agent 侧栏配置，API key 写入 kos-agent 的 `auth.json`（权限 `0600`），不写入 Obsidian `data.json`。

## Skill 如何运行

`41_Skills/` 是 kos-agent 的领域能力层。Skill 应描述：

- 什么时候使用。
- 需要读取哪些规则和模板。
- 如何判断 Vault root。
- 应调用哪些工具或确定性程序。
- 哪些业务事实必须询问用户。
- 输出格式和完成检查。

kos-agent 负责 Skill 发现、加载、trace 和 Eval。`metadata.hermes` 暂时保留用于历史兼容；新能力以 `metadata.kos` 和 kos-agent 行为为准。

## 外部 Agent

Codex、Claude Code、Hermes 等仍可作为外部工具：

1. 在 Vault 目录中打开 Agent。
2. 读取 `.kos.md` 和对应的 `AGENTS.md`、`CLAUDE.md` 或 `.hermes.md`。
3. 遵守对象规范和模板。
4. 修改后运行确定性健康检查。

它们不属于 kos 官方日常产品闭环。kos 不为外部 Agent 单独维护：

- Obsidian chat adapter。
- Session 兼容层。
- 工具事件和 diff 协议。
- Skill 自动触发一致性。
- kos Process Eval 等价保证。

## 维护原则

- 只维护一个官方 Agent 产品：kos-agent。
- 不复制多套对象规范和 Skill。
- 外部 Agent 兼容入口只做开放数据的便利层，不影响 kos-agent 设计。
- 长期知识必须写入 Markdown，不能只存在 kos-agent session。
- kos-agent 不可用时，用户仍能阅读、编辑、导出 Vault 并运行确定性检查。
- kos-agent 安装包提供无 LLM 的 `kos-harness` CLI，用于 Validator、Eval 和确定性工作流。
