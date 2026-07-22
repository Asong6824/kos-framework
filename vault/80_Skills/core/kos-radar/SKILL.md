---
name: kos-radar
description: 将新闻、公告、产品动态、市场变化或研究线索登记为 kos 信息雷达 Signal。
version: 1.0.0
metadata:
  hermes:
    tags: [kos, radar, signal]
    related_skills: [kos-daily-brief, kos-research, kos-reflect]
    pinned: true
  kos:
    scope: core
    lifecycle: active
    created_by: human
    promoted: true
    review_required: false
    object_types: [signal]
    external_systems: []
---
# kos-radar

## When to Use

当用户提供新闻、公告、产品动态、公司事件、宏观变化、研究线索或其他外部变化，并希望纳入信息雷达时使用。

## Prerequisites

- 当前工作目录应为包含 `.kos.md`（或兼容的 `.hermes.md`）的 kos vault 根目录。
- 必须读取 `90_系统/规则/对象规范.md`。
- 优先使用 `90_系统/模板/Signal_信息雷达模板.md`。
- 必须区分事实层、解释层和决策层。

## How to Run

用户输入：

```text
/kos-radar <外部变化或信号>
```

## Quick Reference

1. 明确信号标题、类型、来源、事实、解释、影响、重要性和是否需要研究。
2. 调用 `kos-harness` 创建 Signal。
3. 关联 Project / Research / Concept。
4. 不给出投资买卖、仓位或行动指令。
5. 生成每日信息雷达简报并刷新今日工作台。

## Procedure

### Step 0: 确认 vault 根目录

目标路径必须相对 vault 根目录：

```text
12_信息雷达/<分类>/YYYY-MM-DD_<标题>.md
```

禁止使用：

```text
kos/12_信息雷达/<分类>/YYYY-MM-DD_<标题>.md
```

### Step 1: 提取字段

从用户输入中提取：

- `title`：信号标题。
- `signal_type`：`news` / `earnings` / `policy` / `product` / `market` / `research` / `social` / `macro` / `other`。
- `source_url` / `source_name`：来源。
- `fact`：事实层，发生了什么。
- `interpretation`：解释层，可能意味着什么。
- `impact`：可能影响的已有判断。
- `importance`：`low` / `medium` / `high` / `critical`。
- `confidence`：`low` / `medium` / `high`。
- `requires_research`：是否需要进一步研究。
- `topic` / `company`：相关主题或公司。
- `related_project` / `related_research` / `related_concept`：关联对象。

缺失项可以写成待补充，不要编造来源或事实。

### Step 2: 调用脚本

优先调用确定性脚本：

```bash
kos-harness create --kind signal --title "信号标题" \
  --signal-type "news" \
  --source-name "来源名称" \
  --source-url "https://example.com" \
  --fact "事实层内容" \
  --interpretation "解释层内容" \
  --impact "可能影响" \
  --importance "medium" \
  --confidence "low" \
  --requires-research \
  --topic "相关主题" \
  --related-project "相关项目" \
  --tag "radar"
```

预览时使用：

```bash
kos-harness create --kind signal --title "信号标题" --dry-run
```

### Step 3: 刷新简报和工作台

```bash
kos-harness daily-brief
kos-harness daily-dashboard
kos-harness validate
```

## Pitfalls

- 不要替用户做投资决策。
- 不要给买卖建议、仓位建议或交易指令。
- 不要把解释层写成已经确认的事实。
- 不要把无来源传闻标为高置信度。
- 不要自动创建 Research 或 Project；只建议下一步。

## Verification

- Signal 位于 `12_信息雷达/`。
- frontmatter `type: signal`。
- `status: new`。
- `requires_research` 为布尔值。
- 今日工作台能显示高重要性或需要研究的信号。
- Harness 全部通过。
