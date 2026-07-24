---
name: kos-process-source
description: 根据 kos Source 当前状态执行下一步输入处理。看板点击提取重点、生成摘要、审阅摘要、建立关联或归档时使用；先读取 Source 及关联产物，再调用对应领域 Skill 和 Harness，人工审阅阶段不得由 Agent 自我批准。
version: 1.0.0
metadata:
  hermes:
    tags: [kos, source, pipeline]
    related_skills: [kos-extract, kos-summarize, kos-create-concept, kos-research]
    pinned: true
  kos:
    scope: core
    lifecycle: active
    created_by: human
    promoted: true
    review_required: false
    object_types: [source, extract, summary, research, concept, method]
    external_systems: []
---
# kos-process-source

## When to Use

处理看板选中的单个 Source，并按照 `captured -> extracted -> summarized -> reviewed -> linked -> archived` 推进。用户直接要求继续处理某个 Source 时也使用。

## Prerequisites

- 位于包含 `.kos.md` 的 Vault 根目录。
- 读取 `90_系统/规则/对象规范.md`、选中 Source 及其 `extract_file`、`summary_file`。
- Source 正文较长时使用读取或搜索工具按需定位，不把整篇正文复制进用户消息。
- `summarized -> reviewed` 必须取得用户明确审阅结论。

## How to Run

```text
/kos-process-source
对象：11_原材料/<Source>.md
```

## Quick Reference

1. 定位唯一 Source 并读取当前状态。
2. 按状态选择一个下一步，不跨越管道阶段。
3. 摘录与摘要分别遵守 `kos-extract`、`kos-summarize`。
4. 审阅结论、知识关系与归档事实需要明确依据。
5. 写入后运行 `kos-harness validate`。

## Procedure

根据 Source 当前 `status` 只执行对应分支：

- `captured`：读取 `kos-extract`，生成或补全 Extract；正文不足时停止并说明，不伪造摘录。
- `extracted`：读取 `kos-summarize`，基于 Source/Extract 生成 Summary，保持 `reviewed: false`。
- `summarized`：展示 Summary 路径和待核对重点，使用 `ask_question` 取得“通过”或具体退回意见。通过后才把 Summary 标记为已审并推进 Source；退回时修订后继续保持待审。不能由 Agent 自己确认。
- `reviewed`：分析可建立的 Research、Concept、Method 或 Project 关系。缺少明确关系时先询问；只创建 draft/candidate，不自动晋升。
- `linked`：用户点击归档已经表达归档意图；确认关联产物存在后将 Source 推进到 `archived`。
- `archived`、`ignored`：不重复处理，报告当前终态。

每次只调用当前分支所需的 Skill/Harness。不能因为标题或主题相似就自动建立知识关系。

## Pitfalls

- 不把截断的附件上下文当成完整 Source。
- 不由 Agent 自己确认 Summary 正确。
- 不从 `captured` 直接跳到 `summarized` 或 `linked`。
- 不因生成了 Extract/Summary 就声称用户已经阅读。

## Verification

- Source 状态只前进一个合法阶段。
- Extract、Summary 和知识对象路径真实存在且互相引用一致。
- 人工审阅结论可在当前对话中追溯。
- `kos-harness validate` 通过。
