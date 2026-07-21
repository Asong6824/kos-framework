---
name: kos-update-personal-profile
description: 创建或更新 kos Personal Operating Profile，把测评、日记、复盘、项目行为和 Agent 交互观察整理为可审查、可修正、需用户确认的协作假设。
version: 1.0.0
metadata:
  hermes:
    tags: [kos, profile, reflection, personalization]
    related_skills: [kos-reflect, kos-create-method, kos-eval-skill]
    pinned: true
  kos:
    scope: core
    lifecycle: active
    created_by: human
    promoted: true
    review_required: false
    object_types: [personal_operating_profile]
    external_systems: []
---
# kos-update-personal-profile

## When to Use

当用户希望把盖洛普、荣格、MBTI、Big Five 等测评结果，长期日记、复盘、项目行为或 Agent 交互观察，沉淀成“个人操作画像”时使用。

这个 Skill 不用于人格诊断，也不用于宣称理解用户本质。它只维护当前阶段可用于协作的工作假设。

## Prerequisites

- 当前工作目录应为包含 `.kos.md`（或兼容的 `.hermes.md`）的 kos vault 根目录。
- 必须读取 `90_系统/规则/对象规范.md`。
- 优先使用 `90_系统/模板/PersonalOperatingProfile_个人操作画像模板.md`。
- 可以读取相关 Source、Diary、Reflection、Method、Project 作为证据。
- Agent 只能创建或更新 `status: draft`、`confidence: draft` 的画像。
- `reviewed`、`active`、`verified`、`mature` 必须由用户明确确认。

## How to Run

用户输入：

```text
/kos-update-personal-profile <画像主题或更新说明>
```

示例：

```text
/kos-update-personal-profile 根据我的盖洛普结果和近期项目复盘，整理一个协作画像草稿
```

## Quick Reference

1. 区分证据来源：测评、自我反思、真实行为、Agent 交互观察、他人反馈。
2. 不把任何单一来源当成最终解释权。
3. 把结论写成可验证、可推翻的协作假设。
4. 调用 `kos-harness` 创建 draft。
5. 明确哪些内容仍需验证，哪些旧判断已被推翻。
6. 不自动把 draft 标记为 reviewed 或 active。
7. 运行 Harness 检查。

## Procedure

### Step 0: 确认 vault 根目录

写入前先确认当前目录或目标目录中存在 `.kos.md` 或 `.hermes.md`。

目标路径必须相对 vault 根目录：

```text
25_个人操作画像/<分类>/<画像标题>.md
```

禁止使用：

```text
kos/25_个人操作画像/<分类>/<画像标题>.md
```

### Step 1: 收集证据

把输入拆成证据类型：

| 证据 | 说明 |
|---|---|
| 测评结果 | 盖洛普、荣格、MBTI、Big Five 等，只能作为结构化假设来源 |
| 日记和复盘 | 用户在真实生活中的自我观察 |
| 项目行为 | 长期行动、拖延、完成、放弃、协作中的稳定模式 |
| Agent 交互观察 | 用户在与 Agent 协作时表现出的偏好 |
| 他人反馈 | 外部观察，但仍需用户判断 |

输出时必须标注“这是证据支持的假设”，不要写成固定人格标签。

### Step 2: 提取画像字段

提取：

- `title`：画像标题。
- `category`：分类，默认 `默认`。
- `sources`：相关测评或研究来源。
- `related_reflections`：相关认知记录。
- `related_methods`：相关方法。
- `related_projects`：相关项目。
- `applies_to_skills`：哪些 Skill 可以参考该画像。
- 当前可用结论。
- 支持证据。
- 适用场景。
- 不适用场景。
- 协作偏好。
- 高能量任务。
- 低能量任务。
- 决策盲区。
- Agent 应如何使用。
- 仍需验证的假设。
- 已被推翻的旧判断。

缺失项写成待补充，不要编造事实。

### Step 3: 调用脚本

优先调用确定性脚本：

```bash
kos-harness create --kind personal_operating_profile --title "个人操作画像" \
  --category "默认" \
  --source "盖洛普优势结果" \
  --related-reflection "近期项目复盘" \
  --conclusion "当前可用结论" \
  --evidence "支持证据" \
  --applies-to "适用场景" \
  --not-applies-to "不适用场景" \
  --collaboration-preference "协作偏好" \
  --agent-guideline "只作为协作假设使用"
```

预览时使用：

```bash
kos-harness create --kind personal_operating_profile --title "个人操作画像" --dry-run
```

### Step 4: 人工确认边界

创建后默认：

```yaml
status: draft
confidence: draft
reviewed: false
```

只有用户明确确认后，才可以进入：

```yaml
status: reviewed
confidence: verified
human_confirmed: true
```

只有长期验证后，才可以进入：

```yaml
status: active
confidence: mature
human_confirmed: true
```

### Step 5: 运行 Harness

创建或修改后运行：

```bash
kos-harness validate
```

### Step 6: 输出结果

返回：

- Personal Operating Profile 文件路径。
- 当前 `status` 和 `confidence`。
- 主要证据来源。
- 仍需验证的假设。
- 需要用户确认的字段。

## Pitfalls

- 不要把测评结果当成真实本我。
- 不要把 Agent 交互观察当成完整人格。
- 不要写“你就是某种人”；写“当前证据支持的工作假设是”。
- 不要让画像自动改写所有 Skill 行为。
- 不要忽略不适用场景和被推翻的旧判断。
- 不要自动设置 `reviewed`、`active`、`verified` 或 `mature`。

## Verification

- 文件位于 `25_个人操作画像/`。
- frontmatter `type: personal_operating_profile`。
- 新建时保持 `status: draft`、`confidence: draft`、`reviewed: false`。
- 正文包含支持证据、适用场景、不适用场景、仍需验证假设和已推翻旧判断。
- Harness 全部通过。
