---
name: kos-extract
description: 从 kos Source 生成忠实摘录 Extract，并标记为待人工审核。
version: 1.0.0
metadata:
  hermes:
    tags: [kos, extract, processing]
    related_skills: [kos-ingest, kos-summarize, kos-research]
    pinned: true
  kos:
    scope: core
    lifecycle: active
    created_by: human
    promoted: true
    review_required: false
    object_types: [extract, source]
    external_systems: []
---
# kos-extract

## When to Use

当用户希望从某个 Source 中提取关键原文、准原文、定义、论证、案例或可引用表达时使用。Extract 是忠实材料层，不是摘要，也不是用户理解。

## Prerequisites

- 输入必须能定位到一个 Source 文件。
- 必须读取 `90_系统/规则/对象规范.md`。
- 优先使用 `90_系统/模板/Extract_摘录模板.md`。
- Source 正文不足时，只能生成元信息摘录和待补充事项，不得伪造原文内容。

## How to Run

用户输入：

```text
/kos-extract <Source 文件路径或标题>
```

## Quick Reference

1. 定位 Source。
2. 调用 `90_系统/harness/create_extract.py` 生成 Extract。
3. `review_status` 设为 `pending`。
4. 更新 Source 的 `extract_file`。
5. Source 正文不足时，不要把 Source 状态改成 `extracted`。
6. 运行 Harness 并输出人工审核事项。

## Procedure

### Step 1: 定位并读取 Source

在 `11_原材料/` 下查找用户指定的文件。若匹配多个，列出候选并要求用户确认。

### Step 2: 调用摘录脚本

优先调用确定性脚本：

```bash
python3 90_系统/harness/create_extract.py "<Source 文件路径或标题>"
```

预览时使用：

```bash
python3 90_系统/harness/create_extract.py "<Source 文件路径或标题>" --dry-run
```

脚本会：

- 在 `11_原材料/` 下定位 Source。
- 在 `20_处理区/摘录/` 创建 Extract。
- 设置 `extracted_by: ai`。
- 设置 `review_status: pending`。
- 更新 Source 的 `extract_file`。
- 检测正文是否不足。
- 正文不足时，不把 Source 状态改为 `extracted`。

### Step 3: 摘录正文要求

正文必须包含：

- 来源
- 摘录原则
- 摘录内容
- 关键定义
- 核心观点
- 重要论证
- 案例与数据
- 值得引用的表达
- 需要进一步理解的片段

### Step 4: 更新 Source

如果 Source 当前 `status: captured/selected/converted`，且正文充足，可更新为 `extracted`。

如果 Source 只包含元信息、访问受限提示或“正文尚未抓取”，不要把状态改成 `extracted`。

不要把 Source 更新为 `reviewed`，该状态必须由人确认。

### Step 5: 运行 Harness

生成后运行：

```bash
python3 90_系统/harness/generate_daily_dashboard.py
python3 90_系统/harness/validate_paths.py
python3 90_系统/harness/validate_schema.py
python3 90_系统/harness/validate_state.py
python3 90_系统/harness/validate_permissions.py
python3 90_系统/harness/generate_health_report.py
```

## Pitfalls

- 不要把 Extract 写成 Summary。
- 不要混入用户理解或 AI 解释。
- 不要伪造原文、页码、章节、时间戳或引用。
- 不要把 AI Extract 标记为 `reviewed`。
- Source 正文不足时，必须明确写出“待补充原文”。

## Verification

- Extract 位于 `20_处理区/摘录/`。
- `review_status: pending`。
- Source 的 `extract_file` 指向 Extract。
- 若 Source 正文不足，Source 仍保持原状态。
- Harness 检查通过。
