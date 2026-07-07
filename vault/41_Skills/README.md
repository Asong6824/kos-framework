# 41_Skills 管理说明

`41_Skills/` 存放 kos Skill。这里不是普通资料库，而是 Agent 操作 kos 对象系统的能力层。

kos Skill 是 agent-readable procedure：Hermes Agent、Codex、Claude Code 等后端都可以读取这些过程说明，再结合 `90_系统/harness/` 执行确定性操作。`metadata.hermes` 是为了兼容 Hermes profile 和 pinned 机制，不代表 Skill 只能由 Hermes 使用。

## 目录分层

| 目录 | 作用 | 默认启用 |
|---|---|---|
| `core/` | kos 框架必需能力，负责 Source、Research、Concept、Project、Diary、Reflection、Method、Signal 等核心对象生命周期 | 是 |
| `integrations/` | 外部平台、工具和内容源接入，例如阅读平台、视频平台、外部知识工具 | 视情况 |
| `personal/` | 用户个人定制工作流，例如旅行写作、翻译风格、个人研究偏好 | 视情况 |
| `incubator/` | Agent 或人工临时创建的候选 Skill | 否 |
| `archived/` | 废弃、冻结或历史保留 Skill | 否 |

## 生命周期

```text
idea -> incubator -> reviewed -> core/integrations/personal -> deprecated -> archived
```

Agent 新建 Skill 默认只能写入：

```text
41_Skills/incubator/<skill-name>/SKILL.md
```

晋升到 `core/`、`integrations/` 或 `personal/` 必须由用户明确确认。

晋升前还必须通过对应 Skill eval：

```text
90_系统/evals/skills/<skill-name>.prompts.csv
```

至少覆盖：

- 显式触发。
- 隐式触发。
- 一个负例，防止误触发。
- 该 Skill 最容易腐化的关键步骤或输出约束。

## 元数据

每个 `SKILL.md` 必须包含 `metadata.hermes` 和 `metadata.kos`。前者是 Hermes 兼容字段，后者是 kos 自己的治理字段：

```yaml
metadata:
  hermes:
    tags: [kos]
    pinned: false
  kos:
    scope: incubator
    lifecycle: experimental
    created_by: hermes
    promoted: false
    review_required: true
    object_types: []
    external_systems: []
```

约束：

- `core` Skill 必须 `metadata.hermes.pinned: true`。
- `core` Skill 应声明 `object_types`，纯治理类 Skill 可以为空。
- `integration` Skill 必须声明 `external_systems`。
- `personal` Skill 不强制绑定 kos 核心对象。
- `incubator` Skill 必须 `review_required: true` 且 `promoted: false`。
- `archived` Skill 不进入默认 agent profile；Hermes 环境下也不进入默认 Hermes profile。
