# kos Skill 机制设计

## 1. 文档状态

- 文档性质：内部设计文档
- 适用范围：kos-framework core 和个人 kos 的 Skill 机制
- 当前版本：0.1
- 设计状态：Contract Gate、Task Completion Loop 和 Pi Process Eval runner 已实现；跨后端覆盖和自动晋升报告仍在完善

## 2. 问题背景

Markdown vault 很适合保存人可读的知识和状态，但它本身不定义“怎么操作这些状态”。

如果只给 Agent 一份总体提示词，会出现：

- 同一意图在不同对话中被用不同流程处理。
- 对象路径、frontmatter 和状态流转发生漂移。
- AI 越过人工确认边界。
- 平台集成和个人偏好污染通用框架。
- Agent 自动生成的能力直接进入正式系统。
- 修改提示词后无法判断是否发生行为回归。

kos 需要一个介于“用户意图”和“确定性脚本”之间的执行协议层，这一层就是 Skill。

## 3. 设计目标

Skill 机制希望保证：

1. 用户可以用自然语言或显式命令调用稳定能力。
2. 每个能力有明确触发边界、前置条件、步骤和验证方式。
3. 通用框架、外部集成和个人定制相互隔离。
4. Agent 可以提出和创建新能力，但不能自行改变正式能力集。
5. Skill 的修改可以被检查、评估和回归。
6. framework core 可以单向同步到个人 kos，不覆盖个人能力。

## 4. 非目标

Skill 机制不试图：

- 用 Skill 文本替代所有确定性代码。
- 让所有 Method 都变成 Agent Skill。
- 保证每次 Agent 输出完全一致。
- 让 Agent 无需人工治理就完成能力进化。
- 在 core 中预装所有平台集成和个人偏好。

## 5. 为什么 kos 是 Skill 驱动的

### 5.1 对象表示状态，Skill 表示操作

kos 的 Source、Research、Concept、Project 等对象，主要回答：

```text
系统中现在有什么？
它处于什么状态？
它和其他对象有什么关系？
```

Skill 主要回答：

```text
当用户表达某种意图时，系统应该如何受约束地改变？
```

把状态和操作分开，可以避免将大量流程细节塞进对象模板或总体提示词。

### 5.2 Skill 是 Agent 的可读执行协议

一个完整 Skill 应同时包含：

- 什么时候使用。
- 什么时候不使用。
- 需要什么前置条件。
- 调用哪些 Harness 或工具。
- 哪些状态可以由 AI 修改。
- 哪些状态必须人确认。
- 产物应该如何验证。

这使 Skill 既是运行时指令，也是可审查的设计单元。

## 6. Skill 在整体架构中的位置

```text
用户意图
  -> Skill：识别意图、选择流程、组织上下文
    -> Harness：执行路径、Schema、状态、写入和校验
      -> Template / Schema：定义对象结构
        -> Markdown Object：保存状态
  -> Eval：检查 Skill 的触发、合同和产物
```

Skill 不应重复 Harness 中已经存在的确定性逻辑。

Harness 也不应负责高度依赖语义和上下文的意图判断。

## 7. Method、Skill、Harness、Template 和 Eval 的边界

| 组件 | 核心职责 | 示例 |
|---|---|---|
| Method | 人可理解和实践的可复用方法 | “主流程优先搭建法” |
| Skill | Agent 可执行的意图和流程协议 | `kos-create-project` |
| Harness | 确定性读写和检查 | `create_project.py` |
| Template | 对象的人可读默认结构 | `Project_项目模板.md` |
| Schema | 对象的机器可检查合同 | `project.schema.yaml` |
| Eval | 检查 Skill 合同和行为回归 | `*.prompts.csv` |

### 7.1 Method 何时转化为 Skill

一个 Method 只有在以下条件成立时，才应成为 Skill 候选：

- 有明确且可识别的用户意图。
- 步骤能够被 Agent 执行。
- 产物有可验证的标准。
- 已经至少经过一次真实实践。
- 它不只是一条一次性指令。

## 8. Scope 分层设计

### 8.1 Core

`core` 是 kos-framework 公开发布的框架能力。

判断条件：

- 直接服务 kos 核心对象生命周期。
- 不绑定某个人、账号或外部平台。
- 缺失时会破坏框架的主流程。
- 需要 contract eval 覆盖。

### 8.2 Integrations

`integrations` 负责把外部平台、API、应用或设备接入 kos。

它们不是 core，因为：

- 依赖用户是否使用某个平台。
- 依赖外部 API 和凭据。
- 外部平台变化频率高于 core 对象模型。

### 8.3 Personal

`personal` 保存个人风格、写作习惯、翻译偏好和特定工作流。

它们是个人 kos 的重要能力，但不应作为公开框架的默认假设。

### 8.4 Incubator

`incubator` 是能力隔离区，用于：

- Agent 新生成的 Skill。
- 未确定 scope 的 Skill。
- 尚未完成 eval 的 Skill。
- 正在试验的触发描述和流程。

Incubator 的价值不在于“暂存文件”，而在于防止实验性能力污染正式系统。

### 8.5 Archived

`archived` 保留历史和设计上下文，但不再作为默认执行能力。

## 9. Metadata 设计

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

### 9.1 为什么目录和 metadata 要同时表达 scope

- 目录便于人阅读和工具扫描。
- metadata 便于机器校验、迁移和查询。
- 双重表达让 harness 可以检测目录和声明不一致。

### 9.2 Pinned 的含义

`pinned: true` 不表示质量一定高，它表示这个 Skill 是必须长期保持可用的核心能力，不应被自动策展或归档机制移除。

## 10. Skill 生命周期

```text
需求
-> Method / Skill 判断
-> incubator
-> 补充 contract eval
-> 真实使用
-> 补充 process eval 与 task completion contract
-> 人工评审
-> core / integrations / personal
-> 持续优化和回归
-> deprecated
-> archived
```

### 10.1 新建

Agent 或人可以创建 incubator Skill。

新建时必须说明：

- 触发意图。
- 不应触发的相邻意图。
- 输入和产物。
- 需要的对象和外部系统。
- 人工权限边界。
- 验证方式。

### 10.2 优化

Skill 优化不应只修改 `SKILL.md`。

完整优化流程：

```text
发现真实问题
-> 判断是触发、流程、Harness 还是对象模型问题
-> 先增加失败 case
-> 修改 Skill / Harness / Schema
-> 运行对应 eval
-> 运行系统健康检查
-> 在干净 vault 里验证
```

### 10.3 晋升

Incubator Skill 晋升前必须满足：

- 有明确 scope。
- 没有与已有 Skill 重复。
- metadata 完整。
- contract eval 通过。
- 有真实使用记录。
- 关键失败已转为回归 case。
- 用户明确确认。

### 10.4 归档

归档适用于：

- 能力被新 Skill 替代。
- 外部平台消失或 API 废弃。
- 长期无法通过 eval。
- 证明它只是一次性流程。

归档不是删除历史，而是取消它的默认执行地位。

## 11. Agent 自动创建 Skill

Hermes Agent 可以从重复任务、项目复盘和方法候选中发现 Skill 机会。

但 Agent 的默认权限只到：

```text
创建 incubator Skill
+ 生成 eval 草案
+ 提出 scope 和晋升建议
```

Agent 不可以：

- 直接写入 core。
- 自行设置 `promoted: true`。
- 自行将 `pinned` 改为 `true`。
- 以“eval 通过”替代人对系统边界的判断。

## 12. Skill Eval 与防腐

### 12.1 Contract Eval

检查结构性约定：

- Skill 是否存在。
- scope 和目录是否一致。
- core 是否 pinned。
- 标准章节是否完整。
- 关键附属文件是否存在。
- 关键路径和人工确认规则是否保留。

Contract eval 低成本、稳定，但不能证明 Agent 真的会正确触发。

### 12.2 Process Eval

检查实际 Agent run 的调用与过程：

- 显式调用是否触发。
- 自然语言隐式意图是否触发。
- 相邻但不相同的意图是否不触发。
- 是否执行预期命令。
- 是否保留人工确认边界。
- 是否发生无效循环或过度执行。

### 12.3 Task Completion

在任务执行前用 Task Contract 固定目标、完成条件、语义 rubric 和最大迭代次数。执行后由 Harness 检查确定性证据，由 Agent 提交带证据的 rubric 自评；失败时只对当前任务产物做最小修正。

Task Completion 必须分别报告 `pass@1`、`pass@k`、迭代次数和失败项，不能让反复修补掩盖首次执行质量。

### 12.4 为什么三部分都需要

- 只有 contract eval：可能“文件看起来正确，Agent 实际不触发”。
- 只有 process eval：可能正确调用和执行了流程，但任务产物仍不可用。
- 只有 task completion：可能任务偶然完成，但 Skill 路由错误、越权或过程不可控。

因此 Contract Gate 作为快速结构门禁，Process Eval 保护调用与执行协议，Task Completion 保护任务结果与迭代收敛。

## 13. Framework 和个人 kos 的关系

```text
kos-framework = core 唯一真相源
personal kos = 个人运行实例 + 需求发现 + 实验环境
```

在个人 kos 发现的新需求：

1. 先判断是 core、integration 还是 personal。
2. core 候选先在个人 kos 中实践。
3. 通用化后在 kos-framework 中正式定义。
4. 在干净 vault 中通过 harness 和 eval。
5. 由 framework 单向同步回个人 kos。

不建议双向自动同步，因为它会让 core 的唯一真相源变得不清晰。

## 14. 常见失败模式

### 14.1 Scope 污染

将平台 API、个人路径或写作偏好写入 core。

后果：公开框架无法复用，同步会把个人假设带给其他用户。

### 14.2 Skill 和 Harness 重复逻辑

路径和状态逻辑同时出现在 Skill 文本和 Python 脚本里。

后果：两者逐渐不一致。

### 14.3 Description 过宽

一个 Skill 声称处理过多相邻意图。

后果：误触发、Skill 竞争和不稳定组合。

### 14.4 只写正例

没有负例时，无法知道 Skill 的不触发边界。

### 14.5 Agent 自行晋升

只要生成成功就把 Skill 移到 core。

后果：正式能力集快速膨胀，长期难以维护。

### 14.6 不记录真实失败

修复后没有把失败转为 eval case。

后果：同类问题在后续修改中重复出现。

## 15. 设计取舍

### 15.1 目录分层会增加复杂度

代价：Skill 路径更长，同步和校验逻辑更多。

收益：通用能力、平台依赖和个人偏好的边界可被人和机器共同检查。

### 15.2 人工晋升会降低自动化程度

代价：新能力不能立即进入正式系统。

收益：系统的长期能力边界仍由人负责。

### 15.3 Eval 增加维护成本

代价：修改 Skill 时需要同步修改测试。

收益：Skill 从不可见的 prompt 调整变成可评估的系统资产。

## 16. 替代方案及放弃理由

### 16.1 所有流程都放进一个系统提示词

放弃原因：上下文过大、触发边界模糊、无法单独测试和版本化。

### 16.2 所有 Skill 放在同一层目录

放弃原因：无法区分 framework 必需能力和个人定制，发布时容易泄漏私有内容。

### 16.3 Agent 根据使用频率自动晋升

放弃原因：高频不等于通用，也不等于正确。

### 16.4 仅依靠人工审查 Skill

放弃原因：人工审查很难稳定检测路径、metadata 和已知行为回归。

## 17. 当前已实现

- `core / integrations / personal / incubator / archived` 目录分层。
- `metadata.hermes` 和 `metadata.kos`。
- Agent 新建 Skill 默认进入 incubator 的规则。
- `kos-skill-manager`。
- `kos-eval-skill`。
- `validate_skills.py`。
- `validate_skill_evals.py`。
- 19/19 core Skill contract eval 覆盖。
- Task Contract schema、证据判定和 `pass@1` / `pass@k` 迭代状态。
- Pi Process Eval 合同、标准化 Agent trace、路由 precision / recall 和协议步骤覆盖率。
- framework 到个人 kos 的单向同步。
- 同步前 dry-run、本地修改备份和版本记录。

## 18. 尚未完成

- 扩展全部 core Skill 的 Process Eval，并增加 Codex、Claude Code、Hermes adapter。
- core Skill 的 checked-in Task Contract 与干净 fixture vault 执行。
- 人工确认事件和工具调用先后顺序约束。
- Skill 修改前后的自动对比报告。
- incubator 晋升报告自动生成。
- framework release 版本与 Skill 独立版本的关系。

## 19. 从本文档提炼的用户文档

本文档不应直接公开发布。稳定内容应提炼进随 runtime vault 发布的用户文档：

1. `vault/90_系统/文档/40_Skill管理与防腐.md`：为什么 kos 是 Skill 驱动的，以及如何创建、修改、晋升、归档和评估 Skill。
2. `vault/90_系统/文档/21_对象生命周期.md`：Skill 与对象生命周期、Method、Harness 的关系。
3. `vault/90_系统/文档/10_目录结构.md`：`80_Skills` 的 scope 目录结构和运行时边界。

用户文档必须保留必要的设计理由，但不包含本地推导、未定稿方案和个人使用细节。
