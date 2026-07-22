---
name: kos-create-method
description: 从项目实践、认知记录或研究经验中创建 kos Method candidate，沉淀可复用方法。
version: 1.0.0
metadata:
  hermes:
    tags: [kos, method, skill]
    related_skills: [kos-reflect, kos-update-project]
    pinned: true
  kos:
    scope: core
    lifecycle: active
    created_by: human
    promoted: true
    review_required: false
    object_types: [method]
    external_systems: []
---
# kos-create-method

## When to Use

当用户希望把项目复盘、研究流程、写作经验、编程实践、判断框架或反复出现的做事方式沉淀为可复用方法时使用。

## Prerequisites

- 当前工作目录应为包含 `.kos.md`（或兼容的 `.hermes.md`）的 kos vault 根目录。
- 必须读取 `90_系统/规则/对象规范.md`。
- 优先使用 `90_系统/模板/Method_方法模板.md`。
- AI 可以创建 `status: candidate` 的 Method，但不能自动升级为 `usable` 或 `trusted`。

## How to Run

用户输入：

```text
/kos-create-method <方法名或方法说明>
```

## Quick Reference

1. 明确方法解决的问题、适用场景、不适用场景、前置条件、步骤、判断标准、常见坑和验证方式。
2. 调用 `kos-harness` 创建 Method candidate。
3. 关联来源 Project / Reflection / Concept。
4. 不把 Method 自动标记为 `usable` 或 `trusted`。
5. 运行 Harness 和今日工作台。

## Procedure

### Step 0: 确认 vault 根目录

写入前先确认当前目录或目标目录中存在 `.kos.md` 或 `.hermes.md`。

目标路径必须相对 vault 根目录：

```text
23_方法库/<分类>/<方法名>.md
```

禁止使用：

```text
kos/23_方法库/<分类>/<方法名>.md
```

### Step 1: 提取字段

从用户输入中提取：

- `title`：方法名。
- `category`：方法分类，默认 `未分类`。
- `problem`：方法解决什么问题。
- `scenario`：适用场景。
- `not_scenario`：不适用场景。
- `prerequisite`：前置条件。
- `step`：执行步骤。
- `criteria`：判断标准。
- `pitfall`：常见坑。
- `validation`：验证方式。
- `source_project` / `source_reflection`：来源实践。
- `related_concept`：相关概念。
- `skill_candidate`：未来可转化为 Hermes Skill 的部分。

缺失项可以写成待补充，不要编造事实。

### Step 2: 调用脚本

优先调用确定性脚本：

```bash
kos-harness create --kind method --title "方法名" \
  --category "项目管理方法" \
  --problem "方法解决什么问题" \
  --scenario "适用场景" \
  --not-scenario "不适用场景" \
  --prerequisite "前置条件" \
  --step "第一步" \
  --step "第二步" \
  --criteria "判断标准" \
  --pitfall "常见坑" \
  --validation "如何验证" \
  --source-project "相关项目" \
  --source-reflection "相关反思" \
  --tag "method"
```

预览时使用：

```bash
kos-harness create --kind method --title "方法名" --dry-run
```

### Step 3: 运行 Harness

创建后运行：

```bash
kos-harness daily-dashboard
kos-harness validate
```

### Step 4: 输出结果

返回：

- Method 文件路径。
- `status: candidate`。
- `validated_times: 0`。
- 来源项目或反思。
- 下一次验证方式。

## Pitfalls

- 不要自动设置 `usable` 或 `trusted`。
- 不要把一次性想法包装成已验证方法。
- 不要直接生成 Hermes Skill，除非用户明确要求转化。
- 不要忽略“不适用场景”和“验证方式”。

## Verification

- Method 位于 `23_方法库/`。
- frontmatter `type: method`。
- `status: candidate`。
- `validated_times: 0`。
- Harness 全部通过。
