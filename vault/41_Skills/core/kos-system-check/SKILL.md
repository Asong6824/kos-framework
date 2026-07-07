---
name: kos-system-check
description: 检查 kos 目录、模板、对象规范和核心 kos Skills 是否齐全。
version: 1.0.0
metadata:
  hermes:
    tags: [kos, harness, validation]
    related_skills: [kos-start-my-day]
    pinned: true
  kos:
    scope: core
    lifecycle: active
    created_by: human
    promoted: true
    review_required: false
    object_types: []
    external_systems: []
---
# kos-system-check

## When to Use

当用户希望确认 kos 是否可被 agent 后端正常驱动，或修改模板、Skill、规则后需要检查系统完整性时使用。

## Prerequisites

- 当前工作目录应为 kos vault 根目录。
- 不需要联网。

## How to Run

用户输入：

```text
/kos-system-check
```

## Quick Reference

1. 确认当前 vault 根目录包含 `.kos.md`，或兼容环境下包含 `.hermes.md`。
2. 运行 harness 脚本检查路径、schema、状态、权限、人工确认规则、Skill 治理规则和 Skill Eval 定义。
3. 检查核心目录、模板和 Skill scope 是否存在。
4. 生成健康报告。
5. 输出错误、警告和建议。

## Procedure

### Step 1: 运行 Harness

优先使用脚本检查，而不是只靠模型人工判断。

在 vault 根目录执行：

```bash
python3 90_系统/harness/validate_paths.py --format markdown
python3 90_系统/harness/validate_schema.py --format markdown
python3 90_系统/harness/validate_state.py --format markdown
python3 90_系统/harness/validate_permissions.py --format markdown
python3 90_系统/harness/validate_skills.py --format markdown
python3 90_系统/harness/validate_skill_evals.py --format markdown
python3 90_系统/harness/generate_health_report.py
```

如果任一脚本退出码非 0，必须把它作为错误或警告呈现给用户，并说明修复路径。

健康报告默认写入：

```text
90_系统/harness/reports/health_report.md
```

### Step 2: 检查目录

必须存在：

- `00_工作台`
- `10_收件箱`
- `11_原材料`
- `11_原材料/书籍`
- `11_原材料/播客`
- `11_原材料/文章`
- `11_原材料/新闻`
- `11_原材料/研报`
- `11_原材料/视频`
- `11_原材料/论文`
- `20_处理区/摘录`
- `20_处理区/摘要`
- `21_研究`
- `22_知识库`
- `23_日记`
- `24_认知记录`
- `25_个人操作画像`
- `30_项目`
- `31_任务`
- `40_方法库`
- `41_Skills`
- `41_Skills/core`
- `41_Skills/integrations`
- `41_Skills/personal`
- `41_Skills/incubator`
- `41_Skills/archived`
- `50_信息雷达`
- `50_信息雷达/主题监控`
- `50_信息雷达/公司监控`
- `50_信息雷达/宏观监控`
- `50_信息雷达/每日简报`
- `90_系统/规则`
- `90_系统/模板`
- `90_系统/集成`
- `90_系统/harness`
- `90_系统/harness/reports`
- `90_系统/harness/schemas`
- `90_系统/evals`
- `90_系统/evals/skills`
- `90_系统/evals/schemas`
- `90_系统/evals/artifacts`
- `90_系统/工作流`
- `90_系统/工作流/项目启动计划`
- `90_系统/文档`

禁止存在：

- `kos/11_原材料`
- `kos/20_处理区`
- `kos/21_研究`
- `kos/22_知识库`
- `kos/25_个人操作画像`
- `kos/30_项目`

这些通常表示某个 Skill 把 vault 名称 `kos` 当成了路径前缀，在 vault 内部创建了嵌套 vault。

### Step 3: 检查模板

必须存在：

- `Source_输入源模板.md`
- `Summary_摘要模板.md`
- `Research_研究报告模板.md`
- `Concept_原子概念模板.md`
- `Project_项目模板.md`
- `Task_任务模板.md`
- `Diary_日记模板.md`
- `Dashboard_工作台模板.md`

建议存在：

- `Extract_摘录模板.md`
- `Reflection_认知记录模板.md`
- `Method_方法模板.md`
- `Signal_信息雷达模板.md`
- `Skill_Hermes模板.md`
- `PersonalOperatingProfile_个人操作画像模板.md`

### Step 4: 检查 Skill

检查 `41_Skills/` 下每个 `SKILL.md`：

- frontmatter 是否存在。
- 是否包含 `name`、`description`、`version`。
- `name` 是否不超过 64 个字符。
- `description` 是否不超过 1024 个字符。
- 是否包含 `metadata.hermes.pinned`。
- 是否包含 `metadata.kos.scope`、`metadata.kos.lifecycle`、`metadata.kos.review_required`。
- `core` Skill 是否设置 `metadata.hermes.pinned: true`。
- `integration` Skill 是否声明 `external_systems`。
- `incubator` Skill 是否保持 `promoted: false` 和 `review_required: true`。
- `archived` Skill 是否保持 `pinned: false` 和 `lifecycle: archived`。

### Step 5: 输出报告

### Step 5: 检查 Skill Eval

检查 `90_系统/evals/skills/*.prompts.csv`：

- CSV 表头是否为 `id,skill,should_trigger,prompt,expected_checks,notes`。
- `skill` 是否能在 `41_Skills/` 下找到。
- `should_trigger` 是否为 `true/false`。
- `expected_checks` 是否都是已知检查项。
- 是否存在结构化输出 schema。

### Step 6: 输出报告

使用以下格式：

```markdown
# kos 系统检查报告

## 错误

## 警告

## 建议

## 通过项
```

## Pitfalls

- 不要修改文件，除非用户明确要求修复。
- 不要因为空目录没有内容就报错。
- 不要把建议当成错误。
- 嵌套 `kos/` 目录应作为错误报告，因为它会让 Obsidian 和后续 Skill 读写到错误位置。

## Verification

- 报告中明确区分错误、警告、建议和通过项。
- 每个错误包含可操作的修复路径。
- `90_系统/harness/reports/health_report.md` 已生成或更新。
- Harness 脚本已经实际运行，而不是只口头检查。
