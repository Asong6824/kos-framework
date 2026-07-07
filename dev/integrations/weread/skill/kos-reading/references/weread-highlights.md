# 微信读书划线和想法同步流程

## 目标

把微信读书中某本书的划线和个人想法同步为 kos 可审核材料。

## 数据来源

- `/book/bookmarklist`：单本书划线内容，不含书签内容。
- `/review/list/mine`：单本书个人想法与点评。
- `/user/notebooks`：笔记本概览和数量统计。

## Harness

优先使用确定性脚本：

```bash
python3 90_系统/harness/sync_weread_highlights.py "<书名、bookId 或 Source 路径>"
```

预览时使用：

```bash
python3 90_系统/harness/sync_weread_highlights.py "<书名、bookId 或 Source 路径>" --dry-run
```

脚本会：

- 调 `/book/bookmarklist` 获取划线。
- 调 `/review/list/mine` 获取个人想法。
- 创建或更新 `20_处理区/摘录/<书名>_微信读书划线摘录.md`。
- 更新 Source 的 `extract_file`。
- 只替换 `weread-highlights` 自动同步区，不覆盖 `human-notes`。

如果当前没有划线，默认不创建 Extract。需要占位文件时可加 `--create-empty`。

## 同步策略

第一版采用“一本书一个 Extract 文件”。

目标路径：

```text
20_处理区/摘录/<书名>_微信读书划线摘录.md
```

frontmatter：

```yaml
type: extract
source: "[[11_原材料/书籍/<书名>]]"
created: YYYY-MM-DD
extracted_by: human
review_status: pending
location: "微信读书划线"
tags: [book, weread, highlight]
```

## 正文结构

```markdown
# 摘录：书名

## 来源

- 原始材料：[[11_原材料/书籍/<书名>]]
- 微信读书链接：weread://reading?bId=<bookId>

## 同步说明

- 划线来自微信读书个人划线。
- 想法来自微信读书个人想法 / 点评。
- 本文件是材料层，不等于最终理解。

<!-- weread-highlights:start -->
## 章节：章节名

### 划线

> 原文划线

- bookmarkId:
- chapterUid:
- range:
- createTime:
- deep link:

#### 我的原始想法

- reviewId:
- 内容：
<!-- weread-highlights:end -->

<!-- human-notes:start -->
## 人工整理

- 哪些摘录值得进入 Summary：
- 哪些摘录值得沉淀 Concept：
- 哪些摘录需要复读：
<!-- human-notes:end -->
```

## 去重规则

- 划线按 `bookmarkId` 去重。
- 如果缺少 `bookmarkId`，使用 `bookId + chapterUid + range + markText` 去重。
- 想法按 `reviewId` 去重。
- 同步时只能替换 `weread-highlights` 区间，不得修改 `human-notes` 区间。

## 口径规则

- 问“笔记数量”时，使用 `/user/notebooks` 的 `reviewCount + noteCount + bookmarkCount`。
- 问“导出笔记内容”时，只能导出划线和想法；书签只有数量，没有内容。
- `noteCount` 是划线数，不是总笔记数。
- `reviewCount` 已包含个人点评，不要重复加。
