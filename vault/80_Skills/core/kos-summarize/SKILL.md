---
name: kos-summarize
description: 为 kos 输入源生成结构化摘要，并标记为待人工审核。
version: 1.0.0
metadata:
  hermes:
    tags: [kos, summary, processing]
    related_skills: [kos-ingest, kos-research]
    pinned: true
  kos:
    scope: core
    lifecycle: active
    created_by: human
    promoted: true
    review_required: false
    object_types: [summary, source]
    external_systems: []
---
# kos-summarize

## When to Use

当用户希望处理某个 Source，并生成可审核的结构化 Summary 时使用。

## Prerequisites

- 输入必须能定位到一个 Source 文件。
- 必须读取 `90_系统/规则/对象规范.md`。
- 优先使用 `90_系统/模板/Summary_摘要模板.md`。

## How to Run

用户输入：

```text
/kos-summarize <Source 文件路径或标题>
```

## Quick Reference

1. 定位 Source。
2. 调用 `kos-harness` 生成 Summary。
3. `reviewed` 设为 `false`。
4. 更新 Source 的 `summary_file`。
5. 如果 Source 正文不足，不要把 Source 状态改成 `summarized`。
6. 运行 Harness 并输出待人工审核清单。

## Procedure

### Step 1: 定位并读取 Source

在 `11_原材料/` 下查找用户指定的文件。若匹配多个，列出候选并要求用户确认。

### Step 2: 调用摘要脚本

优先调用确定性脚本：

```bash
kos-harness process-source --kind summary --query "<Source 文件路径或标题>"
```

预览时使用：

```bash
kos-harness process-source --kind summary --query "<Source 文件路径或标题>" --dry-run
```

如果用户未指定 Source，且系统中只有一个 `status: captured` 的 Source，可以省略参数：

```bash
kos-harness process-source --kind summary --query
```

脚本会：

- 在 `11_原材料/` 下定位 Source。
- 在 `20_处理区/摘要/` 创建 Summary。
- 设置 `reviewed: false`。
- 更新 Source 的 `summary_file`。
- 检测正文是否不足。
- 正文不足时，不把 Source 状态改为 `summarized`。

### Step 3: 生成摘要内容

目标目录：

```text
20_处理区/摘要/
```

文件名：

```text
<Source标题>_摘要.md
```

frontmatter 必须包含：

- `type: summary`
- `source`
- `created`
- `generated_by: ai`
- `reviewed: false`
- `tags`

正文必须包含：

- 这份材料在讲什么
- 核心观点
- 关键论证
- 重要案例
- 我需要进一步理解的问题
- 可能关联的概念
- 待人工审核

### Step 4: 更新 Source

如果 Source 当前 `status: captured`，可更新为 `summarized`。

如果已有 `extract_file` 但无 `summary_file`，只补充 `summary_file`。

不要把 Source 更新为 `reviewed`，该状态必须由人确认。

如果 Source 只包含元信息、访问受限提示或“正文尚未抓取”，不要把状态改成 `summarized`，因为这会让工作台误以为材料已经被完整摘要。

### Step 5: 运行 Harness

生成后运行：

```bash
kos-harness validate
```

### Step 6: 输出结果

返回：

- Summary 文件路径。
- Source 状态变化。
- 需要用户确认的重点问题。
- 是否建议继续执行 `/kos-research` 或沉淀 Concept。

## Pitfalls

- 不要把 Summary 标记为已审核。
- 不要把 AI 的理解写成用户的最终判断。
- 不要删除 Source 原文。
- 不要伪造来源、页码、链接或作者。
- Source 正文不足时，只能生成元信息摘要和后续追问，不要假装已经总结了全文。

## Verification

- Summary 位于 `20_处理区/摘要/`。
- `reviewed: false`。
- Source 的 `summary_file` 指向 Summary。
- 若 Source 正文不足，Source 仍保持 `status: captured`。
- Harness 检查通过。
- 输出中列出人工审核事项。
