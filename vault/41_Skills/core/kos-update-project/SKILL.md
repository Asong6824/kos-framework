---
name: kos-update-project
description: 更新 kos Project 的进展、任务、决策、复盘或状态。
version: 1.0.0
metadata:
  hermes:
    tags: [kos, project, progress]
    related_skills: [kos-create-project, kos-start-my-day, kos-end-my-day]
    pinned: true
  kos:
    scope: core
    lifecycle: active
    created_by: human
    promoted: true
    review_required: false
    object_types: [project]
    external_systems: []
---
# kos-update-project

## When to Use

当用户希望记录项目进展、追加下一步任务、记录决策、写阶段性复盘、记录最终成果/沉淀或更新项目状态时使用。

## Prerequisites

- 当前工作目录应为包含 `.kos.md`（或兼容的 `.hermes.md`）的 kos vault 根目录。
- 必须定位到一个 Project；如果只有一个 active 项目，可以自动选择。
- `completed`、`archived`、`cancelled` 等受保护状态必须由用户明确确认。

## How to Run

```text
/kos-update-project <项目名或路径> <进展/任务/决策/复盘说明>
```

## Quick Reference

1. 定位 Project。
2. 调用 `90_系统/harness/update_project.py`。
3. 追加进展、当前任务、决策、复盘、最终成果或最终沉淀。
4. 更新 `updated` 日期。
5. 运行工作台和 Harness。

## Procedure

### Step 1: 调用脚本

```bash
python3 90_系统/harness/update_project.py "项目名" \
  --progress "完成了某项推进" \
  --task "下一步行动" \
  --decision "记录一个关键决策" \
  --review "阶段性复盘" \
  --final-result "最终成果" \
  --final-insight "最终沉淀"
```

受保护状态变更必须显式确认：

```bash
python3 90_系统/harness/update_project.py "项目名" --status completed --human-confirmed
```

脚本会在 `## 状态变更记录` 中记录状态变化。

### Step 2: 运行 Harness

```bash
python3 90_系统/harness/generate_daily_dashboard.py
python3 90_系统/harness/validate_paths.py
python3 90_系统/harness/validate_schema.py
python3 90_系统/harness/validate_state.py
python3 90_系统/harness/validate_permissions.py
python3 90_系统/harness/generate_health_report.py
```

## Pitfalls

- 不要无授权将 Project 标记为 completed、archived 或 cancelled。
- 不要删除已有决策日志和进展。
- 不要把临时任务写成已完成事实。

## Verification

- Project 的 `updated` 已更新。
- 进展/任务/决策/复盘追加到正确章节。
- 今日工作台已刷新。
- Harness 全部通过。
