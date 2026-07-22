---
name: kos-kickoff
description: 将项目想法或收件箱材料转化为项目启动计划，经人工确认后再创建 kos Project。
version: 1.0.0
metadata:
  hermes:
    tags: [kos, project, kickoff]
    related_skills: [kos-create-project, kos-update-project, kos-start-my-day]
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
# kos-kickoff

## When to Use

当用户有一个项目想法、收件箱材料、研究方向或系统建设事项，需要先澄清目标、范围、成功指标、风险和第一批任务，再决定是否创建 Project 时使用。

## Prerequisites

- 当前工作目录应为包含 `.kos.md`（或兼容的 `.hermes.md`）的 kos vault 根目录。
- 必须读取 `90_系统/规则/对象规范.md`。
- `/kos-kickoff` 默认只创建启动计划，不直接创建 Project，除非用户明确确认继续执行。

## How to Run

用户输入：

```text
/kos-kickoff <项目想法或收件箱文件路径>
```

## Quick Reference

1. 判断输入是文件路径还是内联项目想法。
2. 调用 `kos-harness` 创建启动计划。
3. 启动计划写入 `90_系统/工作流/项目启动计划/`。
4. 返回计划路径，让用户确认或修改。
5. 用户确认后，再调用 `kos-harness create --kind project` 创建 Project。

## Procedure

### Step 0: 确认 vault 根目录

目标路径必须相对 vault 根目录：

```text
90_系统/工作流/项目启动计划/Plan_YYYY-MM-DD_Kickoff_<项目名>.md
```

禁止使用：

```text
kos/90_系统/工作流/项目启动计划/...
```

### Step 1: 创建启动计划

启动计划是语义产物，由 Agent 使用文件工具写入固定路径：

```text
90_系统/工作流/项目启动计划/Plan_YYYY-MM-DD_Kickoff_<项目名>.md
```

计划必须包含目标、范围、阶段、首批任务、成功指标、约束、风险和待确认问题。来源是收件箱文件时先读取原文并保留 wikilink。写入后运行 `kos-harness validate`。

### Step 2: 等待人工确认

输出：

- 启动计划路径。
- 建议项目名、类别、优先级、状态。
- 需要用户确认的澄清问题。

不要在没有用户确认的情况下自动创建 Project。

### Step 3: 确认后创建 Project

用户确认后，根据启动计划调用：

```bash
kos-harness create --kind project --title "项目名" \
  --status idea \
  --category other \
  --priority P2 \
  --area "[[领域]]" \
  --primary-goal "[[30_目标/2027-H1/半年目标]]" \
  --goal-alignment direct \
  --why "为什么做" \
  --current-stage "启动计划已确认，进入立项阶段" \
  --problem "当前问题" \
  --process-metric "weekly-progress | 每周有效推进次数 | 2" \
  --result-metric "deliverable | 可验收成果数 | 1" \
  --tag "project"
```

只有用户明确说“开始执行”“设为 active”时，才使用 `--status active`。

### Step 4: 运行 Harness

```bash
kos-harness daily-dashboard
kos-harness validate
```

## Pitfalls

- 不要跳过启动计划直接创建项目，除非用户明确要求。
- 不要把临时想法直接设为 `active`。
- 不要把 AI 的目标澄清当成用户最终确认。
- 不要自动归档收件箱来源；归档应在项目创建确认后再处理。
- 不要创建重复 Project；执行前应搜索 `31_项目/`。

## Verification

- Kickoff plan 位于 `90_系统/工作流/项目启动计划/`。
- 计划包含目标、范围、阶段、成功指标、任务、风险和澄清问题。
- 未经确认时没有新建 Project。
- 如果确认后创建 Project，Project 必须通过 Harness。
