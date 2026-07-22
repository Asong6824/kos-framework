---
name: kos-daily-brief
description: 根据 kos 信息雷达 Signal 生成当日 Daily Brief，并刷新今日工作台。
version: 1.0.0
metadata:
  hermes:
    tags: [kos, radar, daily-brief]
    related_skills: [kos-radar, kos-start-my-day]
    pinned: true
  kos:
    scope: core
    lifecycle: active
    created_by: human
    promoted: true
    review_required: false
    object_types: [signal]
    external_systems: []
---
# kos-daily-brief

## When to Use

当用户希望汇总当天信息雷达、查看重要外部变化、整理需要进一步研究的问题时使用。

## Prerequisites

- 当前工作目录应为包含 `.kos.md`（或兼容的 `.hermes.md`）的 kos vault 根目录。
- 已经有或允许没有 `12_信息雷达/` 下的 Signal。
- 必须保留每日简报中的人工确认区。

## How to Run

用户输入：

```text
/kos-daily-brief
```

## Quick Reference

1. 调用 `kos-harness`。
2. 生成或更新 `12_信息雷达/每日简报/YYYY-MM-DD.md`。
3. 汇总 high / critical / requires_research 的信号。
4. 保留 `<!-- 人手动添加 -->` 区块。
5. 刷新今日工作台并运行 Harness。

## Procedure

### Step 1: 生成每日简报

```bash
kos-harness daily-brief
```

脚本会：

- 汇总当天 Signal。
- 纳入 high / critical 或 `requires_research: true` 的历史 Signal。
- 区分重要变化、主题更新、公司更新、宏观政策、技术趋势、噪音和研究问题。
- 保留人工确认区。

### Step 2: 刷新工作台

```bash
kos-harness daily-dashboard
```

### Step 3: 运行 Harness

```bash
kos-harness validate
```

## Pitfalls

- Daily Brief 是信息摘要，不是决策记录。
- 不要把 AI 的解释写成用户最终判断。
- 不要删除人工确认区。
- 没有 Signal 时也可以生成空简报，表示今天没有雷达输入。

## Verification

- Daily Brief 位于 `12_信息雷达/每日简报/`。
- frontmatter `type: signal` 且 `signal_type: daily_brief`。
- 今日工作台的信息雷达摘要可看到相关变化或研究问题。
- Harness 全部通过。
