---
name: kos-create-watch
description: 创建信息雷达长期关注对象，包括 Topic Watch 和 Company Watch。
version: 1.0.0
metadata:
  hermes:
    tags: [kos, radar, watch]
    related_skills: [kos-radar, kos-daily-brief]
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
# kos-create-watch

## When to Use

当用户希望长期跟踪一个主题、行业、技术方向、公司或竞品时使用。Watch 是长期观察档案，不是单条新闻。

## Prerequisites

- 当前工作目录应为包含 `.kos.md`（或兼容的 `.hermes.md`）的 kos vault 根目录。
- 必须读取 `90_系统/规则/对象规范.md`。
- Topic Watch 使用 `90_系统/模板/TopicWatch_主题监控模板.md`。
- Company Watch 使用 `90_系统/模板/CompanyWatch_公司监控模板.md`。
- 不要替用户做投资买卖、仓位或最终行动判断。

## How to Run

用户输入：

```text
/kos-create-watch <主题或公司>
```

## Quick Reference

1. 判断是主题监控还是公司监控。
2. 调用 `kos-harness` 创建 Watch。
3. Topic Watch 写入 `12_信息雷达/主题监控/`。
4. Company Watch 写入 `12_信息雷达/公司监控/`。
5. 创建后运行 Daily Brief、今日工作台和 Harness。

## Procedure

### Step 0: 确认 vault 根目录

目标路径必须相对 vault 根目录：

```text
12_信息雷达/主题监控/<主题>.md
12_信息雷达/公司监控/<公司>.md
```

禁止使用：

```text
kos/12_信息雷达/主题监控/<主题>.md
```

### Step 1: 提取字段

Topic Watch 字段：

- `name`：主题名。
- `why`：为什么关注。
- `question`：核心问题。
- `keyword`：关键词。
- `source`：主要信息源。
- `next`：下一步关注。
- `related_project` / `related_research` / `related_concept`：关联对象。

Company Watch 字段：

- `name`：公司名。
- `ticker`：股票代码，可空。
- `market`：市场，可空。
- `why`：为什么关注。
- `business`：核心业务。
- `metric`：关键跟踪指标。
- `question`：需要进一步研究的问题。
- `related_topic` / `related_project` / `related_research`：关联对象。

### Step 2: 调用脚本

创建 Topic Watch：

```bash
kos-harness create --kind topic_watch --title "AI Agent" \
  --why "长期关注 AI Agent 的产品、框架和基础设施变化" \
  --question "哪些变化会影响当前研究和项目判断？" \
  --keyword "Agent" \
  --keyword "Hermes" \
  --source "官方博客/RSS/论文/产品发布" \
  --next "持续记录重要 Signal" \
  --tag "radar"
```

创建 Company Watch：

```bash
kos-harness create --kind company_watch --title "NVIDIA" \
  --ticker "NVDA" \
  --market "US" \
  --why "跟踪 AI 基建核心公司" \
  --business "GPU / AI 基础设施" \
  --metric "数据中心收入" \
  --question "增长是否仍由 AI 需求驱动？" \
  --related-topic "AI 基建" \
  --tag "radar"
```

预览时使用 `--dry-run`。

### Step 3: 运行 Harness

```bash
kos-harness daily-brief
kos-harness daily-dashboard
kos-harness validate
```

## Pitfalls

- 不要把 Watch 当成新闻记录；单条新闻应进入 Signal。
- 不要把 AI 的解释写成用户最终判断。
- Company Watch 不能输出交易建议。
- 不要创建重复 Watch；先搜索 `12_信息雷达/主题监控` 和 `12_信息雷达/公司监控`。

## Verification

- Topic Watch 位于 `12_信息雷达/主题监控/`，frontmatter `type: topic_watch`。
- Company Watch 位于 `12_信息雷达/公司监控/`，frontmatter `type: company_watch`。
- 状态为 `active` / `paused` / `archived` 之一。
- Harness 全部通过。
