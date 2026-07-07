---
name: kos-start-my-day
description: 生成或更新 kos 今日工作台，聚合项目、输入源、任务和待审核内容。
version: 1.0.0
metadata:
  hermes:
    tags: [kos, dashboard, daily-planning]
    related_skills: [kos-ingest, kos-system-check]
    pinned: true
  kos:
    scope: core
    lifecycle: active
    created_by: human
    promoted: true
    review_required: false
    object_types: [dashboard]
    external_systems: []
---
# kos-start-my-day

## When to Use

当用户开始一天的学习、研究或工作时使用。目标是生成或更新 `00_工作台/今日工作台.md`，帮助用户看到当前系统状态和今日建议。

## Prerequisites

- 当前工作目录应为 kos vault 根目录。
- 必须读取 `.kos.md`；Hermes 环境下同时读取 `.hermes.md` 和 `90_系统/规则/对象规范.md`。
- 优先使用 `90_系统/模板/Dashboard_工作台模板.md`。

## How to Run

用户输入：

```text
/kos-start-my-day
```

## Quick Reference

1. 确认今天日期。
2. 调用 `90_系统/harness/generate_daily_dashboard.py` 生成或更新工作台。
3. 调用 Harness 校验工作台和系统结构。
4. 输出今日建议和需要用户确认的问题。
5. 不替用户确认今日主线。

## Procedure

### Step 1: 读取系统规则

读取：

- `.hermes.md`
- `90_系统/规则/对象规范.md`
- `90_系统/模板/Dashboard_工作台模板.md`
- `90_系统/harness/generate_daily_dashboard.py`

### Step 2: 生成或更新工作台

优先调用确定性脚本，不要手工重写聚合逻辑：

```bash
python3 90_系统/harness/generate_daily_dashboard.py
```

脚本会：

- 以包含 `.kos.md`（或兼容的 `.hermes.md`）的目录作为 vault 根目录。
- 生成或更新 `00_工作台/今日工作台.md`。
- 扫描 active/idea 项目、待处理输入源、待审核摘要、draft 研究/概念、任务、信息雷达。
- 保留所有 `<!-- 人手动添加 -->` 到 `<!-- /人手动添加 -->` 的手动填写区。
- 禁止创建嵌套 `kos/` 目录。

### Step 3: 运行 Harness

生成工作台后运行：

```bash
python3 90_系统/harness/validate_paths.py
python3 90_系统/harness/validate_schema.py
python3 90_系统/harness/validate_state.py
python3 90_系统/harness/generate_health_report.py
```

如果 Harness 报错，必须在输出中说明错误，不要假装生成成功。

### Step 4: 汇总结果

输出：

- 今日工作台路径。
- Harness 是否通过。
- 活跃项目数量。
- 待处理输入源数量。
- 待审核 AI 产物数量。
- 今日主线建议。

建议必须分为：

- 今日可推进的项目。
- 最值得处理的输入源。
- 需要人工审核的 AI 产物。
- 可能需要降噪或归档的内容。

不要替用户决定今日主线。只能给出建议，并说明依据。

## Pitfalls

- 不要覆盖用户手动填写区。
- 不要直接修改项目目标、优先级和成功指标。
- 不要把 AI 建议写成用户已经确认的决定。
- 没有足够数据时，明确写“暂无数据”，不要虚构。

## Verification

- `00_工作台/今日工作台.md` 存在。
- frontmatter 包含 `type: dashboard`。
- 用户手动填写区被保留。
- `python3 90_系统/harness/validate_schema.py` 通过。
- `python3 90_系统/harness/validate_paths.py` 通过。
- 不存在嵌套 `kos/` 目录。
- 输出中列出已扫描的对象数量和主要建议。
