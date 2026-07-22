# Skill 管理与防腐

Skill 是 kos 的执行层。所有 Skill 必须有明确 scope。

```text
80_Skills/core/
80_Skills/integrations/
80_Skills/personal/
80_Skills/incubator/
80_Skills/archived/
```

本框架只内置 `core`。

## 为什么 kos 是 Skill 驱动的

Markdown 对象记录状态，Skill 规定 Agent 如何操作这些状态。这样做的目的不是增加目录复杂度，而是把 AI 的自由生成限制在可读、可审查、可评估的执行协议里。

Skill 应该回答：

- 什么时候使用。
- 前置条件是什么。
- 需要读取哪些规则或对象。
- 应该调用哪些 Harness。
- 产物写到哪里。
- 哪些步骤必须用户确认。

如果一个流程只是人的经验总结，先写成 `23_方法库/` 里的 Method；只有当它需要被 Agent 反复执行，并且有清晰触发边界时，才应该变成 Skill。

## Scope 判断

| scope | 判断标准 |
|---|---|
| `core` | kos 框架必需能力，缺失会影响通用主流程 |
| `integrations` | 连接外部平台、API、工具或内容源 |
| `personal` | 个人偏好、个人工作流、个人风格 |
| `incubator` | 未审核、实验中、Agent 新建或职责不清 |
| `archived` | 废弃、冻结或历史保留 |

不要把个人写作、翻译、旅行等偏好放进 `core`。不要把外部平台接入放进 `core`。

## 新建 Skill

新 Skill 默认进入：

```text
80_Skills/incubator/<skill-name>/SKILL.md
```

晋升前必须：

- 有明确使用场景。
- 不重复已有 Skill。
- metadata 完整。
- 有 eval prompt CSV。
- eval 通过。
- 用户确认。

Agent 可以新建 incubator Skill 和 eval 草稿，但不能自行晋升到正式目录。

## 修改 Skill

修改 `SKILL.md` 时，优先检查：

- `description` 是否过宽，导致误触发。
- 步骤是否仍调用 Harness，而不是手写路径逻辑。
- 是否遗漏人工确认边界。
- 是否还引用旧目录、旧对象名或旧模板。
- 是否需要同步修改 eval。

修改后运行 Skill 检查和对应 eval。

## 运行 Eval

```bash
node .obsidian/plugins/kos-companion/kos-agent/dist/kos-harness.mjs validate
node .obsidian/plugins/kos-companion/kos-agent/dist/kos-harness.mjs skill-eval --write-artifact
```

指定单个 Skill：

```bash
node .obsidian/plugins/kos-companion/kos-agent/dist/kos-harness.mjs skill-eval --suite <skill-name> --write-artifact
```

## 系统检查

```bash
node .obsidian/plugins/kos-companion/kos-agent/dist/kos-harness.mjs validate
```
