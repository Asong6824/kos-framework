---
name: kos-reading
description: 将微信读书中的书籍、阅读进度、划线和想法接入 kos，并映射为 Source、Extract、Summary、Reflection 等对象。
version: 0.1.0
metadata:
  hermes:
    tags: [kos, reading, weread, source]
    related_skills: [kos-ingest, kos-extract, kos-summarize, kos-reflect, kos-create-concept]
    pinned: false
  kos:
    scope: integration
    lifecycle: active
    created_by: human
    promoted: true
    review_required: false
    object_types: [source, extract, summary, reflection, concept]
    external_systems: [weread]
---
# kos-reading

## When to Use

当用户希望把微信读书中的一本书、书架、阅读进度、划线、想法或阅读统计纳入 kos 时使用。

本 Skill 的目标不是替代微信读书，而是把微信读书中的阅读行为转化为 kos 可追溯、可审核、可复用的知识对象。

## Design Boundary

微信读书负责阅读现场：

- 书籍元信息
- 书架状态
- 阅读进度
- 章节目录
- 划线
- 个人想法 / 点评
- 阅读统计

kos 负责知识对象化：

- `Source(format: book)`：一本书的来源记录
- `Extract`：从划线生成的忠实摘录
- `Summary`：读完或阶段性整理后的结构化摘要
- `Reflection`：阅读后的判断变化、个人想法和读后复盘
- `Concept`：从书中沉淀出的原子概念
- `Research`：多本书或多个材料围绕问题形成的研究报告
- `Dashboard`：待读、在读、待整理、待复盘的聚合视图

## Prerequisites

- 当前工作目录应为包含 `.kos.md`（或兼容的 `.hermes.md`）的 kos vault 根目录。
- 必须读取 `90_系统/规则/对象规范.md`。
- 创建书籍 Source 时优先使用 `90_系统/模板/BookSource_书籍输入源模板.md`。
- 如果需要调用微信读书接口，必须已设置环境变量 `WEREAD_API_KEY`。
- 不要把 API Key 写入任何 kos 文件、模板、日志或文档。
- 若微信读书接口返回 `upgrade_info`，必须先停止当前操作，并按返回指引升级微信读书 skill。

## How to Run

```text
/kos-reading import <书名或微信读书 bookId>
/kos-reading sync-highlights <书名或 Source 路径>
/kos-reading sync-progress <书名或 Source 路径>
/kos-reading review <书名或 Source 路径>
```

## Quick Reference

1. 明确用户意图：导入书籍、同步进度、同步划线、同步想法、读后复盘或阅读统计。
2. 需要微信读书数据时，先用微信读书 skill 查询，不要猜测字段含义。
3. 用 `weread_book_id` 或 `bookId` 定位唯一书籍，避免同名书重复创建。
4. 书籍进入 kos 时创建或更新 `11_原材料/书籍/<书名>.md`。
5. 划线进入 `20_处理区/摘录/`，默认 `review_status: pending`。
6. 个人想法不要直接写成 verified Concept；先作为 Extract 批注或 Reflection raw。
7. AI 生成的摘要、复盘和概念都必须保留待人工审核状态。

## Procedure

### Step 0: 选择子流程

按用户意图选择参考文件：

| 用户意图 | 参考文件 |
|---|---|
| 导入一本微信读书书籍 | `references/weread-import.md` |
| 同步划线和想法 | `references/weread-highlights.md` |
| 同步阅读进度和统计 | `references/weread-progress.md` |
| 读完后复盘和沉淀 | `references/reading-review.md` |
| 判断字段归属和去重规则 | `references/weread-mapping.md` |

### Step 1: 定位书籍

如果用户提供 bookId，直接使用。

如果用户提供书名：

1. 调微信读书 `/store/search`，明确使用电子书搜索。
2. 展示候选书籍供用户确认，除非只有一个明显匹配。
3. 确认后记录 `bookId`，后续所有同步以 `bookId` 为主键。

### Step 2: 创建或更新 Book Source

目标路径：

```text
11_原材料/书籍/<书名>.md
```

frontmatter 必须符合 Source schema：

```yaml
type: source
format: book
title: "书名"
author: "作者"
source_url: ""
source_location: "weread://reading?bId=<bookId>"
created: YYYY-MM-DD
status: captured
related_topics: []
related_projects: []
importance: medium
summary_file: ""
extract_file: ""
tags: [book, weread]
```

微信读书扩展元信息优先写入正文的 `## 微信读书同步元信息`，不要依赖它通过 schema 校验。

### Step 3: 同步章节目录和进度

章节目录来自 `/book/chapterinfo`，写入 Source 正文的自动同步区。

阅读进度来自 `/book/getprogress`，写入 Source 正文的自动同步区或 Daily Dashboard。不要因为 `progress=100` 自动把 Source 标记为 `reviewed`；读完不等于已完成知识处理。

### Step 4: 同步划线为 Extract

划线来自 `/book/bookmarklist`。

每本书第一版建议只创建一个 Extract 文件：

```text
20_处理区/摘录/<书名>_微信读书划线摘录.md
```

正文按章节分组，保留：

- `bookmarkId`
- `chapterUid`
- 章节名
- `range`
- 创建时间
- 原文划线
- 微信读书 deep link

`extracted_by` 建议设为 `human` 或 `mixed`：

- 用户手动划线、未经过 AI 整理：`human`
- AI 做了筛选、重排或补充结构：`mixed`

无论哪种，`review_status` 第一版都保持 `pending`，因为进入 kos 后仍需人工确认哪些摘录值得沉淀。

### Step 5: 同步想法为批注或 Reflection

个人想法来自 `/review/list/mine`。

归属规则：

- 绑定某条划线的想法：写入对应 Extract 条目下的“我的原始想法”。
- 章节级想法：写入 Extract 的章节批注区。
- 整本书点评：创建 `Reflection raw` 或读后复盘草稿。
- 明显可复用的概念：只列为 Concept 候选，除非用户明确要求创建 Concept。

### Step 6: 读后复盘

当用户明确说读完、或微信读书进度为 `100%` 且用户要求整理时，创建读后复盘草稿。

复盘问题：

- 我为什么读这本书？
- 读之前希望解决什么问题？
- 读完后哪些判断发生变化？
- 哪些观点我接受，哪些不同意？
- 哪些内容应该进入 Project / Research / Concept / Method？
- 哪些章节或摘录值得复读？

## Pitfalls

- 不要全量同步书架后无差别创建大量 Source。
- 不要把微信读书“划线”直接等同于已审核 Extract。
- 不要把微信读书“想法”直接升级为 Concept。
- 不要覆盖人工编辑区。
- 不要在 Source 正文混入 AI 的最终理解。
- 不要把 `progress=1` 解读为读完；微信读书进度是 0-100 的百分比。
- 不要只按书名去重；必须优先使用 `bookId`。

## Verification

- 书籍 Source 位于 `11_原材料/书籍/`。
- Source `format: book`。
- Source 正文包含微信读书同步元信息和 bookId。
- Extract 位于 `20_处理区/摘录/`，且 `review_status: pending`。
- 自动同步区和人工编辑区分离。
- 未写入 API Key。
- Harness 检查通过。
