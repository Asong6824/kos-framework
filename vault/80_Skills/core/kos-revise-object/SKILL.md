---
name: kos-revise-object
description: 根据用户退回意见修订待审阅的 Extract、Summary、Research、Concept、Reflection、Method 或 Personal Operating Profile。看板点击“退回 AGENT”时使用；没有具体反馈必须先询问，修订后保持待审状态，不能替用户批准或晋升。
version: 1.0.0
metadata:
  hermes:
    tags: [kos, review, revision]
    related_skills: [kos-extract, kos-summarize, kos-research, kos-create-concept, kos-create-method, kos-reflect, kos-update-personal-profile]
    pinned: true
  kos:
    scope: core
    lifecycle: active
    created_by: human
    promoted: true
    review_required: false
    object_types: [extract, summary, research, concept, reflection, method, personal_operating_profile]
    external_systems: []
---
# kos-revise-object

## When to Use

用户从待审队列退回 Agent 产物，要求纠错、补证据、缩减推断、重写结构或重新生成时使用。

## Prerequisites

- 位于包含 `.kos.md` 的 Vault 根目录。
- 读取选中对象、来源链接、对象规范和对应领域 Skill。
- 区分用户原始内容、来源事实与 Agent 生成内容。
- 没有退回原因时必须使用 `ask_question` 获取具体意见。

## How to Run

```text
/kos-revise-object
对象：<待审对象路径>
```

## Quick Reference

1. 读取对象和来源证据。
2. 取得具体退回意见，不猜测用户不满意什么。
3. 只修改反馈涉及的内容，保留可验证事实和来源。
4. 修订后继续保持 pending/draft/raw/candidate/unreviewed。
5. 运行 `kos-harness validate` 并报告差异。

## Procedure

先检查对象是否确实处于待审状态，再使用 `ask_question` 询问退回原因。可提供“事实错误、证据不足、推断过度、结构不清、与本人观点不符、其他”作为选择，但必须允许自由说明。

根据对象类型读取对应领域 Skill：Extract 使用 `kos-extract`，Summary 使用 `kos-summarize`，Research 使用 `kos-research`，Concept 使用 `kos-create-concept`，Method 使用 `kos-create-method`，Reflection 使用 `kos-reflect`，画像使用 `kos-update-personal-profile`。这些 Skill 提供对象约束，不表示重新创建对象；优先原位修订选中文件。

修改前概括计划，修改后列出实际变化和仍待用户确认的事项。用户反馈与来源冲突时保留来源事实，同时明确标注用户判断，不把两者混写。

## Pitfalls

- 不把“退回”解释为删除文件或否定全部内容。
- 不在没有反馈时自行重写。
- 不把用户观点伪装成来源事实。
- 不把修订后的对象自动标记为 reviewed、verified、mature、usable、trusted 或 active。

## Verification

- 修改范围与用户反馈一致。
- 原有来源和事实没有被无依据删除。
- 对象保持待审状态。
- `kos-harness validate` 通过。
