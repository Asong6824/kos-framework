# 微信读书书籍导入流程

## 目标

把微信读书中的一本书登记为 kos `Source(format: book)`，作为后续划线、摘要、复盘和概念沉淀的入口。

## 输入

用户可以提供：

- 书名
- 微信读书 `bookId`
- 微信读书 deep link
- 书架中的编号选择

## 流程

1. 如果输入是书名，先调用微信读书 `/store/search` 获取候选书籍。
2. 用户确认后，记录 `bookId`。
3. 调 `/book/info` 获取书籍元信息。
4. 调 `/book/chapterinfo` 获取章节目录。
5. 检查 `11_原材料/书籍/` 下是否已有同一 `bookId` 的 Source。
6. 如果不存在，创建新 Source。
7. 如果已存在，只更新自动同步区，不覆盖人工编辑区。
8. 运行 kos harness 校验。

## Harness

优先使用确定性脚本：

```bash
WEREAD_API_KEY="$WEREAD_API_KEY" python3 90_系统/harness/import_weread_book.py "<书名或 bookId>"
```

预览时使用：

```bash
WEREAD_API_KEY="$WEREAD_API_KEY" python3 90_系统/harness/import_weread_book.py "<书名或 bookId>" --dry-run
```

脚本会：

- 调 `/store/search` 或 `/book/info` 定位书籍。
- 调 `/book/chapterinfo` 同步目录。
- 用 `bookId` 检查是否已有 Source。
- 创建或更新 `11_原材料/书籍/` 下的 Source。
- 只更新自动同步区，不覆盖人工编辑区。

## Source 正文建议结构

```markdown
# 书名

> 来源：微信读书 | 作者 | 收集日期

## 来源信息

- 书名：
- 作者：
- 出版社：
- 出版时间：
- ISBN：
- 微信读书链接：weread://reading?bId=<bookId>

## 阅读目的

<!-- human-notes:start -->
- 我为什么读这本书：
- 希望解决的问题：
- 关联项目：
- 关联研究：
<!-- human-notes:end -->

## 微信读书同步元信息

<!-- weread-sync:start -->
- bookId:
- 最近同步：
- 阅读状态：
- 阅读进度：
- 章节数：
<!-- weread-sync:end -->

## 目录

<!-- weread-chapters:start -->
自动同步章节目录。
<!-- weread-chapters:end -->

## 待处理

- [ ] 是否同步划线
- [ ] 是否生成摘要
- [ ] 是否写读后复盘
- [ ] 是否沉淀 Concept / Research / Method
```

## 创建规则

- 文件名使用书名，清理 `/`、换行和控制字符。
- `source_location` 使用 `weread://reading?bId=<bookId>`。
- `tags` 至少包含 `book` 和 `weread`。
- 不要把 AI 摘要或个人理解写入 Source 的自动同步区。
