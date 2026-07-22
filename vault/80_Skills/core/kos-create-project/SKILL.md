---
name: kos-create-project
description: 将想法、研究方向或计划创建为 kos Project。用户提出“研究某主题”“做一个项目”或希望评估想法是否值得投入时应使用；创建前读取当前 H1/H2 Goal 与占比，判断支持度、取舍并建立至少一个量化过程或结果指标。
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

1. 读取当前 H1/H2 Goal，分析项目的主要/支持 Goal、支持度和取舍。
2. 从用户输入中提取项目名、类别、优先级、阶段以及至少一个量化过程或结果指标。
3. 调用 `kos-harness` 创建 Project。
4. 默认 `status: idea`，只有用户明确要开始执行时才设为 `active`。
5. 创建后运行 Harness 和今日工作台生成脚本。
6. 输出项目路径和下一步建议。

## Procedure

### Step 0: 确认 vault 根目录

写入前先确认当前目录或目标目录中存在 `.kos.md` 或 `.hermes.md`。

所有目标路径都必须相对 vault 根目录：

```text
31_项目/项目名/项目名.md
```

禁止使用以下路径：

```text
kos/31_项目/项目名/项目名.md
/path/to/your/kos/31_项目/项目名/项目名.md
```

### Step 1: 判断项目字段

先回答五个支持度问题：是否直接改变 Goal 指标或交付物；是否提供必需能力/基础设施/决策；关联是因果路径还是仅主题相近；延迟的真实代价；会挤占哪些 Goal 容量。然后在 `direct/enabling/exploratory/off_goal/conflicting` 中选择，不用关键词相似度代替判断。

从用户输入中提取：

- `title`：项目名，必须有。
- `primary_goal`：主要支持的 H1/H2 Goal，可为空。
- `supporting_goal`：其他受支持 Goal，可有多个。
- `goal_alignment`：`direct/enabling/exploratory/off_goal/conflicting` 之一。
- `why`：为什么做。
- `status`：默认 `idea`；正在执行才用 `active`。
- `category`：必须是 `learning/research/writing/product/coding/investment/career/system/other` 之一。
- `priority`：默认 `P2`；当前主线或关键项目可设 `P0/P1`。
- `current_stage`：默认想法澄清阶段或启动阶段。
- `problem`：当前需要解决的问题。
- `process_metric`：量化过程指标。
- `result_metric`：量化结果指标。两类允许只填一类，但至少必须有一项。
- 下一步行动作为创建后的建议返回，不写进 Project；需要跟踪时创建独立 Task。

不要编造用户没有给出的事实；可以把缺失项写成待补充。

若只有过程指标，允许创建，但必须明确提示“缺少结果指标”；反之亦然。指标写成带稳定 `id/kind/name/unit/baseline/target/current/updated/evidence` 的结构化记录。

若用户坚持推进 `off_goal` 或 `conflicting` Project，记录 `off_goal_override`、理由和复查日期，随后继续协助执行；提醒转移到周报/月报，不在每天重复劝阻。

### Step 2: 调用创建脚本

优先调用确定性脚本：

```bash
kos-harness create --kind project --title "项目名" \
  --status idea \
  --category other \
  --priority P2 \
  --primary-goal "[[30_目标/2027-H1/半年目标]]" \
  --goal-alignment direct \
  --why "为什么做" \
  --current-stage "想法澄清阶段" \
  --problem "当前问题" \
  --process-metric "weekly-research | 每周完成专题研究次数 | 2" \
  --result-metric "publish | 发布研究文章数 | 3" \
  --tag "标签"
```

如果需要先预览，使用：

```bash
kos-harness create --kind project --title "项目名" --result-metric "deliverable | 可验收成果数 | 1" --dry-run
```

### Step 3: 运行 Harness

创建后运行：

```bash
kos-harness daily-dashboard
kos-harness validate
```

### Step 4: 输出结果

返回：

- Project 文件路径。
- 创建出的 status、category、priority。
- 今日工作台是否已刷新。
- 需要用户补充或确认的字段。

## Pitfalls

- 不要把临时想法直接设成 `active`，除非用户明确要开始推进。
- 不要把任务、摘要或研究报告声明为项目主文件；项目资料可放在 `31_项目/项目名/` 中。
- 不要在 vault 根目录下创建 `kos/31_项目/` 嵌套目录。
- 不要替用户确认最终成功指标；缺失时写成待补充或待确认。
- 不要用“持续推进”“提高质量”等不可计数描述冒充量化指标。
- 不要把主题相近误判为对 Goal 的实际贡献。
- 不要阻止用户已明确选择的低支持度 Project；记录 override 和复查日期。
- Project 的 `updated` 必须在后续实质推进时更新。

## Verification

- Project 主文件位于 `31_项目/项目名/项目名.md`，同目录只存在一个 `type: project` 文件。
- frontmatter `type: project`。
- `status/category/priority` 符合 schema 枚举。
- `created` 和 `updated` 为当天日期。
- `process_metrics` 和 `result_metrics` 至少一个非空。
- 支持度属于 direct/enabling/exploratory/off_goal/conflicting，并有因果与容量取舍说明。
- 今日工作台能显示 active/idea 项目。
- Harness 检查通过。
