---
name: kos-research
description: 围绕一个具体问题创建 kos Research draft，并列出候选 Concept。
version: 1.0.0
metadata:
  hermes:
    tags: [kos, research, synthesis]
    related_skills: [kos-summarize, kos-ingest, kos-create-project]
    pinned: true
  kos:
    scope: core
    lifecycle: active
    created_by: human
    promoted: true
    review_required: false
    object_types: [research, concept]
    external_systems: []
---
# kos-research

## When to Use

当用户提出一个需要综合多个来源、形成判断框架的问题时使用。输出是 `Research` 初稿，不是最终结论。

## Design Source

本 Skill 迁移自 OrbitOS 的 `/research` 思路：先识别上下文和研究策略，再生成结构化研究笔记。kos 不直接照搬 OrbitOS 的两 agent 执行方式，而是使用确定性脚本创建 Research draft，并通过 Harness 控制对象状态。

## Prerequisites

- 必须明确研究问题。
- 当前工作目录应为包含 `.kos.md`（或兼容的 `.hermes.md`）的 kos vault 根目录。
- 必须读取 `90_系统/规则/对象规范.md`。
- 优先使用 `90_系统/模板/Research_研究报告模板.md`。
- 如涉及概念沉淀，必须读取 `90_系统/模板/Concept_原子概念模板.md`。

## How to Run

用户输入：

```text
/kos-research <研究问题>
```

## Quick Reference

1. 明确研究问题和所属领域。
2. 搜索已有 Source、Summary、Research、Concept、Project，避免重复。
3. 调用 `90_系统/harness/create_research.py` 创建 Research draft。
4. 将可沉淀内容写为“候选 Concept”，不要自动创建 verified Concept。
5. 运行今日工作台和 Harness。
6. 输出研究文件路径、关联来源、候选 Concept 和待人工确认事项。

## Procedure

### Step 0: 确认 vault 根目录

写入前先确认当前目录或目标目录中存在 `.kos.md` 或 `.hermes.md`。

所有目标路径都必须相对 vault 根目录：

```text
21_研究/<领域>/<研究主题>.md
```

禁止使用以下路径：

```text
kos/21_研究/<领域>/<研究主题>.md
/path/to/your/kos/21_研究/<领域>/<研究主题>.md
```

### Step 1: 研究计划

从用户输入中提取：

- `question`：研究问题，必须具体。
- `title`：研究标题。
- `area`：所属领域，默认 `[[未分类]]`。
- `goal`：研究目标。
- `background`：为什么现在研究。
- `related`：显式关联的 Source、Summary、Project 或 Concept。
- `concept-candidate`：候选概念。

如果问题过宽，先收窄为一个可回答的问题。不要把宽泛主题直接写成研究结论。

### Step 2: 搜索现有系统

搜索：

- `11_原材料/`
- `20_处理区/摘要/`
- `21_研究/`
- `22_知识库/`
- `30_项目/`

优先复用已有材料。若已有相近 Research，优先更新或提示用户确认，不要创建重复研究。

### Step 3: 调用研究脚本

优先调用确定性脚本：

```bash
python3 90_系统/harness/create_research.py "研究问题" \
  --title "研究标题" \
  --area "[[领域]]" \
  --goal "研究目标" \
  --background "背景" \
  --related "相关 Source 或 Summary 路径/标题" \
  --related "相关 Project 路径/标题" \
  --concept-candidate "候选概念" \
  --tag "research"
```

如果需要先预览，使用：

```bash
python3 90_系统/harness/create_research.py "研究问题" --dry-run
```

脚本会：

- 在 `21_研究/<领域>/` 创建 Research。
- 设置 `status: draft`。
- 设置 `confidence: draft`。
- 自动发现相关 Source、Summary、Concept、Project。
- 在正文列出候选 Concept。
- 不创建或验证 Concept。

### Step 4: Concept 边界

可以在 Research 中列出“候选 Concept”，例如：

- Harness
- 防腐层
- Skill 自进化

但除非用户明确要求，不要自动创建 `22_知识库/` 下的 Concept 文件。

即使创建 Concept，也必须：

- `status: draft`
- `confidence: draft`
- 不得设为 `verified` 或 `mature`
- 明确标记需要人工审核

### Step 5: 运行 Harness

生成后运行：

```bash
python3 90_系统/harness/generate_daily_dashboard.py
python3 90_系统/harness/validate_paths.py
python3 90_系统/harness/validate_schema.py
python3 90_系统/harness/validate_state.py
python3 90_系统/harness/generate_health_report.py
```

### Step 6: 输出结果

返回：

- Research 文件路径。
- `status` 和 `confidence`。
- 关联的 Source/Summary/Project/Concept 数量。
- 候选 Concept。
- 待用户确认的问题。

## Pitfalls

- 不要把 Research draft 写成最终判断。
- 不要将缺少来源的推断伪装成事实。
- 不要自动将 Concept 提升到 `verified`。
- 不要替用户决定项目方向。
- 不要为了填满正文而编造来源、作者、事实或案例。

## Verification

- Research 文件位于 `21_研究/`。
- `status: draft` 且 `confidence: draft`。
- 有明确 `question`。
- 资料来源、推断和待确认判断被区分。
- 候选 Concept 只是候选，没有自动 verified。
- 今日工作台显示该 Research 为待审核。
- Harness 检查通过。
