---
name: kos-reflect
description: 从日记、项目推进、阅读或对话中创建 kos Reflection raw，记录判断变化和后续验证问题。
version: 1.0.0
metadata:
  hermes:
    tags: [kos, reflection, diary]
    related_skills: [kos-end-my-day, kos-create-method]
    pinned: true
  kos:
    scope: core
    lifecycle: active
    created_by: human
    promoted: true
    review_required: false
    object_types: [reflection]
    external_systems: []
---
# kos-reflect

## When to Use

当用户希望把日记、项目复盘、阅读后的想法、一次对话、失败经验或判断变化提炼成认知记录时使用。

## Prerequisites

- 当前工作目录应为包含 `.kos.md`（或兼容的 `.hermes.md`）的 kos vault 根目录。
- 必须读取 `90_系统/规则/对象规范.md`。
- 优先使用 `90_系统/模板/Reflection_认知记录模板.md`。
- AI 可以创建 `status: raw` 的 Reflection，但不能把它自动升级为 `developed` 或 `archived`。

## How to Run

用户输入：

```text
/kos-reflect <反思主题或判断变化>
```

## Quick Reference

1. 明确反思主题、触发背景、原有想法、变化、原因、影响和后续验证。
2. 调用 `90_系统/harness/create_reflection.py` 创建 Reflection raw。
3. 关联 Diary / Project / Source / Research / Concept / Method。
4. 不把 AI 整理写成用户原始想法。
5. 运行 Harness 和今日工作台。

## Procedure

### Step 0: 确认 vault 根目录

写入前先确认当前目录或目标目录中存在 `.kos.md` 或 `.hermes.md`。

目标路径必须相对 vault 根目录：

```text
24_认知记录/<分类>/<主题>_反思.md
```

禁止使用：

```text
kos/24_认知记录/<分类>/<主题>_反思.md
```

### Step 1: 提取字段

从用户输入中提取：

- `title`：反思主题。
- `category`：分类，默认 `未分类`。
- `source_diary`：来源日记。
- `trigger`：触发背景。
- `previous_view`：原来怎么想。
- `changed_view`：现在的变化。
- `reason`：为什么发生变化。
- `impact`：可能影响什么。
- `to_verify`：后续要验证什么。
- `related_project` / `related_research` / `related_concept` / `related_method`：关联对象。

缺失项可以写成待补充，不要编造事实。

### Step 2: 调用脚本

优先调用确定性脚本：

```bash
python3 90_系统/harness/create_reflection.py "反思主题" \
  --category "项目反思" \
  --source-diary "2026-05-28" \
  --trigger "触发背景" \
  --previous-view "我原来怎么想" \
  --changed-view "现在的变化" \
  --reason "为什么发生变化" \
  --impact "这个变化可能影响什么" \
  --to-verify "后续验证问题" \
  --related-project "相关项目" \
  --tag "reflection"
```

预览时使用：

```bash
python3 90_系统/harness/create_reflection.py "反思主题" --dry-run
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

- Reflection 文件路径。
- `status: raw`。
- 关联日记、项目和知识对象。
- 待人工补充或确认事项。

## Pitfalls

- 不要自动设置 `developed` 或 `archived`。
- 不要把 AI 的整理伪装成用户原始想法。
- 不要把 Reflection 写成正式 Research 或 Concept。
- 不要覆盖日记中的人工填写区。

## Verification

- Reflection 位于 `24_认知记录/`。
- frontmatter `type: reflection`。
- `status: raw`。
- Harness 全部通过。
