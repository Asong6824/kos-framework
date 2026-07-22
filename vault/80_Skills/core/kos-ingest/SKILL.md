---
name: kos-ingest
description: 将文章、论文、书籍、视频、播客、研报或新闻登记为 kos 输入源。
version: 1.0.0
metadata:
  hermes:
    tags: [kos, source, ingestion]
    related_skills: [kos-summarize, kos-start-my-day]
    pinned: true
  kos:
    scope: core
    lifecycle: active
    created_by: human
    promoted: true
    review_required: false
    object_types: [source]
    external_systems: []
---
# kos-ingest

## When to Use

当用户提供 URL、文本、文件路径、书名、论文、视频、播客、新闻或研报，并希望纳入 kos 时使用。

## Prerequisites

- 当前工作目录应为 kos vault 根目录。
- 写入前必须确认 vault 根目录是包含 `.kos.md`（或兼容的 `.hermes.md`）的目录。
- 必须读取 `90_系统/规则/对象规范.md`。
- 优先使用 `90_系统/模板/Source_输入源模板.md`。

## How to Run

用户输入：

```text
/kos-ingest <材料或说明>
```

## Quick Reference

1. 判断输入源格式。
2. 生成 Source frontmatter。
3. 写入 `11_原材料/<format>/` 对应目录。
4. 状态设为 `captured`。
5. 不把个人理解写进 Source。
6. 如内容来自收件箱，可在原收件箱文件中标记处理结果或保留链接。

## Procedure

### Step 0: 确认 vault 根目录

写入前先确认当前目录或目标目录中存在 `.kos.md` 或 `.hermes.md`。

所有目标路径都必须相对 vault 根目录：

```text
11_原材料/文章/标题.md
```

禁止使用以下路径：

```text
kos/11_原材料/文章/标题.md
/path/to/your/kos/11_原材料/文章/标题.md
```

如果发现当前工作目录不是包含 `.kos.md`（或兼容的 `.hermes.md`）的 kos vault 根目录，先切换到正确目录或使用包含 `.hermes.md` 的绝对路径。

### Step 1: 识别格式

按以下映射选择目录和 `format`：

- 书籍：`11_原材料/书籍/`，`format: book`
- 论文：`11_原材料/论文/`，`format: paper`
- 文章：`11_原材料/文章/`，`format: article`
- 视频：`11_原材料/视频/`，`format: video`
- 播客：`11_原材料/播客/`，`format: podcast`
- 研报：`11_原材料/研报/`，`format: report`
- 新闻：`11_原材料/新闻/`，`format: news`

无法判断时，先放入 `10_收件箱/`，并说明需要用户确认。

### Step 2: 创建 Source

文件命名使用材料标题，避免包含 `/`、换行和控制字符。

目标目录必须使用已有目录，不要新建同名顶层 vault 目录：

```text
11_原材料/<格式目录>/
```

frontmatter 必须包含：

- `type: source`
- `format`
- `title`
- `created`
- `status: captured`
- `importance`
- `tags`

### Step 3: 写入正文

正文只记录来源、原始内容或来源说明。不要写大量个人理解。

如果用户提供完整文本，可以放入 `## 原始内容或来源说明`。

如果用户只提供 URL，记录 URL、标题、作者和待处理事项。

### Step 4: 输出结果

返回：

- 创建的文件路径。
- 判断出的格式和状态。
- 建议下一步：是否执行 `/kos-summarize` 或创建 Extract。

## Pitfalls

- 不要在 vault 根目录下创建 `kos/` 子目录。`kos` 是 vault 自身名称，不是对象路径的一部分。
- 不要把摘要误写进 Source，摘要应进入 `20_处理区/摘要/`。
- 不要把用户观点和原文混在一起。
- 不确定作者、日期、主题时留空或写入待确认，不要编造。
- **微信公众号等受限来源**：`mp.weixin.qq.com` 等 URL 常触发验证码/POC Token，浏览器和 curl 均可能无法直接抓取正文。此时应：
  1. 用 curl + 桌面 User-Agent 提取页面中的 `msg_title`、`nickname`、`ct`（时间戳）等元信息。
  2. 在 Source 正文中注明访问受限，正文尚未抓取。
  3. 建议用户在微信内打开后手动粘贴全文，再执行后续处理。
  4. 不要因抓取失败而跳过登记——元信息本身就有价值。

## Verification

- 新文件位于 `11_原材料/<格式>/`。
- 不存在新建的 `kos/11_原材料/` 嵌套目录。
- frontmatter YAML 可解析。
- `status` 为 `captured`。
- Source 正文没有混入未经确认的个人理解。
- 若来源受限无法抓取正文，Source 中已注明限制原因并列出待补充事项。
