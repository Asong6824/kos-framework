---
name: kos-plan-half-year
description: 帮助用户梳理、创建、评审或调整当前 H1/H2 半年目标。用户提到半年规划、H1、H2、目标占比、目标冲突或希望确立方向时应使用；形成 Goal drafts、量化结果和总和为 100 的待确认投入占比。
version: 1.0.0
metadata:
  hermes:
    tags: [kos, goal, h1, h2]
    related_skills: [kos-create-project, kos-review-period]
    pinned: true
  kos:
    scope: core
    lifecycle: active
    created_by: human
    promoted: true
    review_required: false
    object_types: [goal, reflection]
    external_systems: []
---
# kos-plan-half-year

## When to Use

用户希望确立或修改 H1/H2 目标、讨论目标占比，或周期复盘显示当前想法与目标长期偏离时使用。

## Prerequisites

- 读取当前周期 Goal、上期复盘、现有责任和外部承诺。
- 目标周期只能是 `YYYY-H1` 或 `YYYY-H2`，不创建年度或月度 Goal。
- 结果定义、激活、暂停、达成、放弃和 active 权重变化都等待用户确认。

## How to Run

先访谈并创建 draft：

```bash
kos-harness create --kind goal --title "目标" --period 2027-H1 --allocation-weight 40 --metric "量化结果"
```

确认整组占比：

```bash
kos-harness set-goal-weights --input '{"period":"2027-H1","humanConfirmed":true,"changes":[...]}'
```

## Quick Reference

1. 明确期望结果、量化指标、不做什么、约束和代价。
2. 先形成 draft，再讨论 `allocation_weight`。
3. 当前周期 active Goal 合计必须恰好 100。
4. 展示变更影响并等待用户确认。
5. Goal 达成只引用结果证据，不看 Task 数量。

## Procedure

把候选目标压缩为半年内可验证的结果，指出互相争夺的容量。给出建议占比及理由，但不机械转换为每天时长。使用原子 `set-goal-weights` 一次提交整组变更；合计不为 100 时回到讨论，不做部分写入。发现持续的 off-goal 投入时，尊重已执行选择，同时讨论是修订 Goal、调整占比还是减少 Project。

## Pitfalls

- 不创建年度/月度 Goal。
- 不未经确认激活或调整 active Goal。
- 不把活动清单写成结果目标。
- 不按 Task 数量自动改变 Goal 健康度。

## Verification

- Goal 位于 `30_目标/YYYY-H1|H2/`。
- active Goal 的 allocation_weight 都大于 0 且合计 100。
- 结果定义、指标、不做什么和约束存在。
- 权重历史和用户确认写入 Markdown。
- `kos-harness validate` 通过。
