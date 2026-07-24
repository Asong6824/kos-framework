---
name: kos-review-period
description: 生成或讨论 kos 周报、月报和目标/项目组合复盘。用户说周报、本周复盘、月报、月度复盘、投入偏差、目标是否要改时应使用；分析 Goal 投入趋势、Project 指标与策略、Task 流动、低支持度投入和 Capability Focus 证据，所有重大修改保持待确认。
version: 1.0.0
metadata:
  hermes:
    tags: [kos, weekly-review, monthly-review, portfolio]
    related_skills: [kos-plan-half-year, kos-end-my-day]
    pinned: true
  kos:
    scope: core
    lifecycle: active
    created_by: human
    promoted: true
    review_required: false
    object_types: [reflection, goal, project, task, personal_operating_profile]
    external_systems: []
---
# kos-review-period

## When to Use

用户要求周报、月报、周期复盘、目标调整建议或 Project 组合检查时使用。

## Prerequisites

- 读取当前 H1/H2 Goal、Project 指标、Task 完成与推荐反馈。
- 只使用 Vault Markdown 中的事实；插件缓存不能成为报告事实源。
- Capability Focus 仅在 `applies_to` 命中 `weekly-review` 或 `monthly-review` 时加载。

## How to Run

```bash
kos-harness review-week --date YYYY-MM-DD
kos-harness review-month --date YYYY-MM-DD
```

## Quick Reference

1. 周报检查 Goal 投入偏差、Project 指标/里程碑/阻塞和反复推迟拒绝。
2. 月报增加 Goal 健康、策略假设、Project 继续/暂停/取消建议。
3. 对 off_goal/conflicting 投入只在周期复盘提醒，不每日重复。
4. 能力强化只总结证据与适用性。
5. Goal、权重、重大指标和画像变化只形成 draft，不自动修改。

## Procedure

先调用 Harness 构造周期事实和报告骨架，再由 LLM 比较 Goal 投入、Project 指标与策略、Task 流动和关键证据。不得把模板汇总直接当成周期判断。解释目标 `allocation_weight` 与近 28 天估算投入的趋势差异，避免伪精确。核对 Project 的过程指标、结果指标、里程碑、阻塞、验证完成与预期成功是否分开记录。汇总 repeated deferred/rejected Task。对已确认继续的低支持度 Project，尊重选择并在此处提示及时修改 Goal、占比或组合。

LLM 必须给出继续、调整、暂停、停止或补充证据的理由和取舍，并把建议写入报告的系统管理块；Goal、Project、权重和画像的实际修改仍等待用户确认后调用 Harness。

Capability Focus 只分析本期真实实践证据；读取 `capability_focus.applies_to`，并保留 `max_daily_recommendations` 的每日最多一个显式强化约束。可提出 `suggest_profile_revision` 草稿，但不修改 active Profile。所有目标和画像建议明确标为“待用户确认”。

## Pitfalls

- 不用 Task 数量证明 Goal 成功。
- 不把过程指标等同结果成功。
- 不自动修改 Goal 权重、Project 方向或 active 画像。
- 不把 off_goal 提醒重复放回每日交互。

## Verification

- 周报和月报位于 `41_认知记录/周期复盘/`。
- 包含投入偏差、Project 指标与阻塞、Task 流动、低支持度提醒和 Capability Focus 证据。
- `review-week`、`review-month` 的建议均标记为待确认且不自动修改对象。
- `kos-harness validate` 通过。
