# 微信读书到 kos 的字段映射

## 核心原则

微信读书数据进入 kos 时，先映射到已有对象，不新增 Book 对象。

```text
微信读书 book      -> Source(format: book)
微信读书划线       -> Extract
微信读书个人想法   -> Extract 批注 / Reflection raw
微信读书读完状态   -> Source 正文同步区 / Dashboard 提醒
微信读书阅读统计   -> Dashboard / Reading report
```

## 唯一键

第一版必须保存以下外部 ID，避免重复同步：

| 微信读书字段 | 用途 |
|---|---|
| `bookId` | 书籍唯一键 |
| `bookmarkId` | 划线唯一键 |
| `reviewId` | 想法 / 点评唯一键 |
| `chapterUid` | 章节定位 |
| `range` | 划线位置定位 |

## Source 映射

| 微信读书字段 | kos 字段或位置 |
|---|---|
| `bookId` | Source 正文 `## 微信读书同步元信息` |
| `title` | frontmatter `title` |
| `author` | frontmatter `author` |
| `cover` | Source 正文元信息 |
| `publisher` | Source 正文元信息 |
| `publishTime` | Source 正文元信息 |
| `isbn` | Source 正文元信息 |
| `newRating` | Source 正文元信息 |
| `source_location` | `weread://reading?bId=<bookId>` |
| `chapters[]` | Source 正文自动同步区 |

## Extract 映射

| 微信读书字段 | kos 字段或位置 |
|---|---|
| `bookmarkId` | Extract 条目元信息 |
| `bookId` | 通过 Source 追溯 |
| `chapterUid` | Extract 条目元信息 |
| `chapterName` | Extract 章节标题 |
| `markText` | Extract 原文摘录 |
| `createTime` | Extract 条目元信息，展示时转为 `YYYY-MM-DD` |
| `range` | Extract 条目元信息和 deep link |
| `colorStyle` | 可选元信息 |

## 个人想法映射

| 微信读书想法类型 | kos 归属 |
|---|---|
| 划线下想法 | 对应 Extract 条目下的“我的原始想法” |
| 章节点评 | Extract 章节批注区 |
| 整本书点评 | Reflection raw 或读后复盘草稿 |
| 明确概念理解 | Concept 候选，不自动创建 verified Concept |

## 状态映射

微信读书状态不直接覆盖 kos 状态。

| 微信读书状态 | kos 处理 |
|---|---|
| 加入书架 | Source `status: captured` |
| 开始阅读 | Source 正文记录 `reading_status: reading` |
| `progress=100` | Source 正文记录 `reading_status: finished`，但不自动设为 `reviewed` |
| 有划线 | 可创建 Extract，Source 可进入 `extracted` |
| 有摘要且人工审核 | Source 才可进入 `summarized` 或 `reviewed` |

## 自动同步区

自动同步内容必须包裹在标记中，避免覆盖人工内容。

```markdown
<!-- weread-sync:start -->
自动同步内容
<!-- weread-sync:end -->

<!-- human-notes:start -->
人工整理区
<!-- human-notes:end -->
```

同步脚本只能替换 `weread-sync` 区间，不得修改 `human-notes` 区间。
