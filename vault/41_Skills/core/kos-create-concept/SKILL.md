---
name: kos-create-concept
description: 将研究、摘要或用户说明沉淀为 kos Concept draft。
version: 1.0.0
metadata:
  hermes:
    tags: [kos, concept, knowledge]
    related_skills: [kos-research, kos-summarize]
    pinned: true
  kos:
    scope: core
    lifecycle: active
    created_by: human
    promoted: true
    review_required: false
    object_types: [concept]
    external_systems: []
---
# kos-create-concept

## When to Use

当用户希望把研究报告、摘要、阅读理解、项目经验或一个明确术语沉淀为原子概念时使用。

## Prerequisites

- 当前工作目录应为包含 `.kos.md`（或兼容的 `.hermes.md`）的 kos vault 根目录。
- 必须读取 `90_系统/规则/对象规范.md`。
- 优先使用 `90_系统/模板/Concept_原子概念模板.md`。
- 必须保持 `status: draft` 和 `confidence: draft`，除非用户明确人工确认升级。

## How to Run

用户输入：

```text
/kos-create-concept <概念名或概念说明>
```

## Quick Reference

1. 明确概念名、定义、所属领域和来源。
2. 调用 `90_系统/harness/create_concept.py` 创建 Concept draft。
3. 关联 Source / Summary / Research / Project。
4. 不把 Concept 自动标记为 `verified` 或 `mature`。
5. 运行 Harness 和今日工作台。

## Procedure

### Step 0: 确认 vault 根目录

写入前先确认当前目录或目标目录中存在 `.kos.md` 或 `.hermes.md`。

目标路径必须相对 vault 根目录：

```text
22_知识库/<领域>/<概念名>.md
```

禁止使用：

```text
kos/22_知识库/<领域>/<概念名>.md
```

### Step 1: 提取字段

从用户输入中提取：

- `title`：概念名。
- `area`：所属领域，默认 `[[未分类]]`。
- `definition`：定义。
- `problem`：解决什么问题。
- `importance`：为什么重要。
- `understanding`：我的理解。
- `source`：单一主来源。
- `related_research`：相关 Research。
- `related_project`：相关 Project。
- `related_concept`：相关 Concept。

缺失项可以写成待补充，不要编造事实。

### Step 2: 调用脚本

优先调用确定性脚本：

```bash
python3 90_系统/harness/create_concept.py "概念名" \
  --area "[[领域]]" \
  --definition "定义" \
  --problem "解决什么问题" \
  --importance "为什么重要" \
  --understanding "我的理解" \
  --source "相关 Research 或 Source 路径/标题" \
  --related-project "相关 Project 路径/标题" \
  --tag "concept"
```

预览时使用：

```bash
python3 90_系统/harness/create_concept.py "概念名" --dry-run
```

### Step 3: 运行 Harness

创建后运行：

```bash
python3 90_系统/harness/generate_daily_dashboard.py
python3 90_系统/harness/validate_paths.py
python3 90_系统/harness/validate_schema.py
python3 90_系统/harness/validate_state.py
python3 90_系统/harness/validate_permissions.py
python3 90_系统/harness/generate_health_report.py
```

### Step 4: 输出结果

返回：

- Concept 文件路径。
- `status: draft`。
- `confidence: draft`。
- 关联来源和研究。
- 待人工确认事项。

## Pitfalls

- 不要自动设置 `verified` 或 `mature`。
- 不要把 AI 的表达伪装成用户已确认的定义。
- 不要创建没有来源或没有适用场景的空泛概念，除非用户明确要求先占位。
- 不要把 Research 全文复制进 Concept。

## Verification

- Concept 位于 `22_知识库/`。
- frontmatter `type: concept`。
- `status: draft`。
- `confidence: draft`。
- 关联来源保留。
- Harness 全部通过。
