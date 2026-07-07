---
name: kos-create-project
description: 将想法、目标、问题或计划创建为 kos Project 对象。
version: 1.0.0
metadata:
  hermes:
    tags: [kos, project, planning]
    related_skills: [kos-start-my-day, kos-research]
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
# kos-create-project

## When to Use

当用户提出一个想法、目标、研究方向、系统建设事项、写作计划、产品计划或长期行动，并希望纳入 kos 项目管理时使用。

## Prerequisites

- 当前工作目录应为 kos vault 根目录。
- 写入前必须确认 vault 根目录是包含 `.kos.md`（或兼容的 `.hermes.md`）的目录。
- 必须读取 `90_系统/规则/对象规范.md`。
- 优先使用 `90_系统/模板/Project_项目模板.md`。

## How to Run

用户输入：

```text
/kos-create-project <项目想法或项目说明>
```

## Quick Reference

1. 从用户输入中提取项目名、目标、类别、优先级、阶段、问题、成功指标和下一步任务。
2. 调用 `90_系统/harness/create_project.py` 创建 Project。
3. 默认 `status: idea`，只有用户明确要开始执行时才设为 `active`。
4. 创建后运行 Harness 和今日工作台生成脚本。
5. 输出项目路径和下一步建议。

## Procedure

### Step 0: 确认 vault 根目录

写入前先确认当前目录或目标目录中存在 `.kos.md` 或 `.hermes.md`。

所有目标路径都必须相对 vault 根目录：

```text
30_项目/项目名.md
```

禁止使用以下路径：

```text
kos/30_项目/项目名.md
/path/to/your/kos/30_项目/项目名.md
```

### Step 1: 判断项目字段

从用户输入中提取：

- `title`：项目名，必须有。
- `goal`：项目目标。
- `why`：为什么做。
- `status`：默认 `idea`；正在执行才用 `active`。
- `category`：必须是 `learning/research/writing/product/coding/investment/career/system/other` 之一。
- `priority`：默认 `P2`；当前主线或关键项目可设 `P0/P1`。
- `current_stage`：默认想法澄清阶段或启动阶段。
- `problem`：当前需要解决的问题。
- `success`：可验收的成功指标。
- `task`：下一步行动。

不要编造用户没有给出的事实；可以把缺失项写成待补充。

### Step 2: 调用创建脚本

优先调用确定性脚本：

```bash
python3 90_系统/harness/create_project.py "项目名" \
  --status idea \
  --category other \
  --priority P2 \
  --goal "项目目标" \
  --why "为什么做" \
  --current-stage "想法澄清阶段" \
  --problem "当前问题" \
  --success "成功指标" \
  --task "下一步行动" \
  --tag "标签"
```

如果需要先预览，使用：

```bash
python3 90_系统/harness/create_project.py "项目名" --dry-run
```

### Step 3: 运行 Harness

创建后运行：

```bash
python3 90_系统/harness/generate_daily_dashboard.py
python3 90_系统/harness/validate_paths.py
python3 90_系统/harness/validate_schema.py
python3 90_系统/harness/validate_state.py
python3 90_系统/harness/generate_health_report.py
```

### Step 4: 输出结果

返回：

- Project 文件路径。
- 创建出的 status、category、priority。
- 今日工作台是否已刷新。
- 需要用户补充或确认的字段。

## Pitfalls

- 不要把临时想法直接设成 `active`，除非用户明确要开始推进。
- 不要把任务、摘要或研究报告写进 `30_项目/`。
- 不要在 vault 根目录下创建 `kos/30_项目/` 嵌套目录。
- 不要替用户确认最终成功指标；缺失时写成待补充或待确认。
- Project 的 `updated` 必须在后续实质推进时更新。

## Verification

- Project 位于 `30_项目/`。
- frontmatter `type: project`。
- `status/category/priority` 符合 schema 枚举。
- `created` 和 `updated` 为当天日期。
- 今日工作台能显示 active/idea 项目。
- Harness 检查通过。
