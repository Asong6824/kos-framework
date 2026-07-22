---
name: kos-start-my-day
description: 为一天制定可确认的结构化计划。用户说开始一天、安排今天、今天做什么、排任务或需要每日建议时都应使用；读取 H1/H2 Goal、Project、公共 Task Pool、推迟记录和当日约束，生成最多三项建议并处理接受、调整、推迟或拒绝。
version: 2.0.0
metadata:
  hermes:
    tags: [kos, daily-planning, goal, task-pool]
    related_skills: [kos-end-my-day, kos-create-project]
    pinned: true
  kos:
    scope: core
    lifecycle: active
    created_by: human
    promoted: true
    review_required: false
    object_types: [goal, project, task, dashboard]
    external_systems: []
---
# kos-start-my-day

## When to Use

在用户开始一天、询问今天应推进什么、希望从任务池排出今日计划，或处理昨日未完成事项时使用。结果是可逐项确认的每日建议，不是自动替用户做决定。

## Prerequisites

- 位于包含 `.kos.md` 或 `.hermes.md` 的 Vault 根目录。
- 读取 `90_系统/规则/对象规范.md` 和 `90_系统/文档/25_半年目标与推进.md`。
- 询问或接受用户给出的可用分钟、精力和硬约束；缺失时可使用保守默认值并明确说明。

## How to Run

```bash
kos-harness start-day --input '{"availableMinutes":120,"energy":"medium","hardConstraints":[]}' --format json
```

对每项反馈调用：

```bash
kos-harness recommendation-feedback --input '{"date":"YYYY-MM-DD","runId":"...","recommendationId":"...","action":"accepted"}'
```

## Quick Reference

1. 让 Harness 构造 PlanningContext，不自行扫描后拼接另一套候选；读取 `taskPool.archiveCandidates` 但不把已完成项作为今日行动推荐。
2. 排除尚未到 `defer_until` 的 Task。
3. 按硬承诺、解除阻塞、到期/doing、Goal 投入偏差、里程碑、维护事项排序。
4. 默认最多三项，不要求凑满。
5. 将 recommended 与 accepted/adjusted/deferred/rejected 分开。
6. 用户确认后才把 Task 写入今日计划。

## Procedure

### 1. 获取确定性上下文

PlanningContext 必须包含当前 H1/H2 Goal 与 `allocation_weight`、近 28 天估算投入、Project 支持度与里程碑、Task Pool、昨日未完成、约束、Validator 异常，以及仅在适用时加载的 Capability Focus 摘要。不要把 Goal 占比机械换算成当天时间配额。

### 2. 形成建议

最多推荐三项：一项主要 Goal 推进，一项硬承诺/解除阻塞/维护，一项可选收尾、探索或能力练习。每项写明 Task、Goal、Project、预计投入、理由和取舍。`off_goal`/`conflicting` 默认不主动推荐；用户已经记录 override 且存在硬承诺时可以纳入，但不重复劝阻。

### 3. 限制能力强化

只有 active `capability_focus` 的 `period` 与当前 H1/H2 相同，且 `applies_to` 包含 `start-day` 时才参考。每日最多一个建议显式使用能力强化，且不能覆盖截止、阻塞、外部承诺或用户选择；遵守 `max_daily_recommendations`。

### 4. 处理反馈

推荐状态独立于 Task 状态：`recommended -> accepted|adjusted|deferred|rejected`。接受或调整后写 `scheduled_for`；推迟写 `defer_until`；拒绝只记录原因，不能删除 Task。相同 Context fingerprint 可恢复，Context 改变后创建新 run，不覆盖旧反馈。

## Pitfalls

- 不推荐尚未到 `defer_until` 的 Task。
- 不把确定性排序冒充 Agent 建议，也不把建议冒充用户计划。
- 不用 Task 数量推断 Goal 进度。
- 不因主题相近就宣称 Task 推进了多个 Project。
- 不让 Capability Focus 渗透到全部建议。

## Verification

- 每日计划写入 `00_工作台/计划/YYYY-MM-DD.md`，包含 run ID 和 Context fingerprint。
- 看板明确区分确定性事实、Agent 建议和用户已确认计划。
- 建议不超过三项，每项包含理由、取舍和预计投入。
- deferred Task 在到期前未出现。
- 反馈写回 Markdown 和 Task `recommendation_history`。
- `kos-harness validate` 通过。
