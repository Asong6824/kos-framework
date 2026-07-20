# Agent 与 Harness 基础

## 1. 统一定义

kos-agent 使用以下基础模型：

```text
Agent = LLM + Harness
```

### LLM

LLM 指实际执行推理和生成的模型。模型 provider、API 客户端和流式协议属于模型接入工程，不是模型本身。

### Harness

Harness 指包围 LLM、让它能够理解环境、采取行动、保持状态、接受反馈并可靠完成任务的全部系统：

- 模型 provider 接入、请求和流式事件。
- Agent loop 和 tool-call loop。
- system prompt、上下文选择、压缩和记忆。
- Tools、Skills、命令和外部集成。
- Session、任务状态、队列、取消和恢复。
- 文件系统、工作目录、沙箱和执行环境。
- 执行策略、业务确认和副作用处理。
- UI、问题交互、diff、进度和错误展示。
- 日志、metrics、trace 和可观测性。
- Validator、测试、Eval、review 和反馈循环。
- 调度、重试、并发和长任务管理。

因此，Harness 不是 `validate_*.py` 的同义词，也不是 Agent 外面的另一个服务。确定性脚本只是 Harness 的一个组成部分。

### Harness Engineering

Harness Engineering 是围绕 LLM 设计上述系统，使模型可以看见正确上下文、使用合适能力、得到高质量反馈，并在可观测、可控制的环境中完成任务。

它关注的核心问题不是“如何让模型再努力一点”，而是：

- 模型缺少什么上下文？
- 模型能否看见系统真实状态？
- 工具接口是否清晰、低歧义、可组合？
- 失败是否能产生模型可理解的反馈？
- 架构和正确性要求是否可被程序强制？
- 任务过程是否可观察、可中断、可复现？
- 哪些知识应成为系统记录，而不是只留在一次对话中？

## 2. Pi 的官方定位与包分层

Pi 官方首页直接将 Pi 定义为：

> Pi is a minimal agent harness. Adapt Pi to your workflows, not the other way around.

这里的 “Pi” 是项目和设计理念的总称，不能在实现架构中当成一个单体依赖。与 kos-agent 相关的分层是：

| 层 | 提供的能力 | kos-agent 的采用方式 |
|---|---|---|
| `pi-ai` | provider/model API、认证、流式响应、消息与 tool schema | 复制源码、测试和许可证，作为模型层基线 |
| `pi-agent-core` | Agent loop、状态、事件、队列、附件，以及可复用的 session、compaction、Skills 等 Harness 能力 | 复制源码与测试，作为通用运行时基线 |
| `pi-coding-agent` | 完整 coding Harness，包括 session、工具、资源加载、extensions、CLI/TUI、SDK 和 RPC | 复制后作为 kos-agent 的直接代码基线 |
| kos-agent | 在 coding-agent 基线上加入 kos Context、工作流、反馈和 Obsidian 体验 | 本项目维护的 fork |

上游代码关系和 kos fork 关系是：

```text
pi-ai
  ↑
pi-agent-core
  ↑
pi-coding-agent
  │ source fork
  ↓
kos-agent
```

kos-agent 在产品分层上仍处于 coding-agent 层，但实现策略不是 clean-room 重写，而是源码 fork。初次导入必须包含上游测试、MIT License、来源仓库、tag/commit 和导入日期；后续同步必须能区分上游变更与 kos patch。

默认保留并改造 `pi-coding-agent` 已有的 session、branch、compaction、模型配置、工具、资源加载、extension、SDK/RPC 和测试，不重新实现。TUI 不是 kos 产品界面；Obsidian 取代 interactive TUI，但可以复用其交互语义和非 UI 核心。

## 3. kos-agent 的执行原则

kos-agent 只有 YOLO 一种执行模式：工具参数通过 schema 后立即执行，不弹出逐次权限确认，也不提供 plan/safe/strict 等模式切换。UI 应展示正在执行的工具、结果、错误和 diff，但展示不是执行前授权。

`ask_question` 仍然存在，用于补充缺失信息或提供人工审阅节点，但不是强制门禁。Agent 可以自主修改对象状态；也可以在研究收尾后挂起一个问题，提示用户审阅，收到回答后再把状态更新为 `reviewed` 或 `complete`。

## 4. Harness Engineering 的工程启示

OpenAI 的 Harness Engineering 实践强调，当 Agent 缺少工具、抽象、内部结构和反馈循环时，问题通常不是模型能力不足，而是环境没有被设计得足够清晰和可执行。

其中可复用的原则包括：

- Humans steer; agents execute。
- 工程工作的重点转向设计环境、表达意图和建立反馈循环。
- 应让 UI、日志、metrics 和 trace 对 Agent 可读，使 Agent 能验证自己的工作。
- 仓库知识应成为系统记录，而不是依赖口头上下文。
- 架构、依赖方向和质量要求应由机械规则强制，而不只写在文档中。
- 高吞吐 Agent 会持续产生熵，需要测试、review、清理和持续维护机制。

Anthropic 对 Agent 的定义也支持同一分层：基础构件是被 retrieval、tools 和 memory 增强的 LLM；workflow 由预定义代码路径编排 LLM 和工具，agent 则由 LLM 动态决定过程和工具使用。无论采用 workflow 还是 agent loop，这些增强和编排都属于 Harness。

## 5. kos-agent 中的 Harness 范围

kos-agent 的 Harness 跨越多个仓库目录，而不是只存在于 `agent/`：

| Harness 能力 | 当前或目标载体 |
|---|---|
| provider/model API 与流式协议 | vendored `pi-ai` |
| Agent loop、session、compaction、Skills 等通用 Harness | vendored `pi-agent-core` |
| 模型配置、session、资源、extensions、文件工具和 headless 接口 | forked `pi-coding-agent` 基线 |
| kos 上下文构建和 Skill 约束 | kos patch + Vault |
| 缺失的通用工具和 Web 能力 | 优先采用成熟 Pi package、provider SDK 或社区库；不支持 MCP |
| Vault 对象操作和确定性检查 | 从 `vault/90_系统/harness/` 迁入 kos-agent |
| YOLO 执行、业务问题和任务状态 | `agent/` |
| 对话、工具状态、diff 和问题 UI | `ob-plugin/` |
| 对象规范、模板和用户 Skill | `vault/` 中的 Harness context |
| Process Eval、Task Completion 和发布反馈 | `dev/` + kos-agent runtime |

这些组件在源码中可以分包、分进程，但在概念上共同组成一个 Harness。

## 6. 对后续设计的约束

- 不再讨论“kos-agent 与 Harness 谁是主运行时”；kos-agent 本身就是 LLM 与 Harness 的组合。
- 讨论“下沉到 Harness”时，意思是把能力从临时模型行为变成 kos-agent 的稳定上下文、工具、状态、执行策略、UI 或反馈机制。
- 增加 `ask_question`、`web_search` 或 Obsidian 工具状态，都是 Harness Engineering。
- 将 Python 脚本迁出用户 Vault，只是改变 Harness 的实现和分发位置，不是引入另一个架构层。
- LLM 可以更换；kos-agent 的核心产品价值主要沉淀在 Harness。
- Pi 已有能力应优先随源码基线继承和改造，不能无理由重写。
- 缺失能力必须先做社区调研和许可证、安全性、维护状态评估，确认不能采用后才自研。
- 当前 Vault 中强制人工确认的 Validator 和 Skill 文字属于 legacy 行为；迁移到 kos-agent 时改为 YOLO 可自主执行、按需 `ask_question`。

## 7. 资料来源

- [Pi 官方首页：Pi is a minimal agent harness](https://pi.dev/)
- [Mario Zechner：What I learned building an opinionated and minimal coding agent](https://mariozechner.at/posts/2025-11-30-pi-coding-agent/)
- [Pi Documentation](https://pi.dev/docs/latest)
- [Pi monorepo](https://github.com/earendil-works/pi)
- [Claudian](https://github.com/YishenTu/claudian)
- [OpenAI：Harness engineering: leveraging Codex in an agent-first world](https://openai.com/index/harness-engineering/)
- [Anthropic：Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)
