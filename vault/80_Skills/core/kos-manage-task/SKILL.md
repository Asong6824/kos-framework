---
name: kos-manage-task
description: 使用 LLM 创建、澄清、拆解、编辑、排期、推迟、阻塞、完成、归档或流转 kos Task。用户要求新建任务、修改任务、加入今日计划、退回任务池、分析阻塞、记录结果或判断 Project 贡献时使用；先理解目标、项目、依赖和完成证据，再调用确定性 kos Harness 写入。
version: 1.0.0
metadata:
  hermes:
    tags: [kos, task, planning, execution]
    related_skills: [kos-start-my-day, kos-update-project, kos-end-my-day]
    pinned: true
  kos:
    scope: core
    lifecycle: active
    created_by: human
    promoted: true
    review_required: false
    object_types: [task, project, goal]
    external_systems: []
---
# kos-manage-task

## When to Use

管理 Task 的完整生命周期时使用。看板传入的 `intent` 只表示用户动作，仍需读取 Task、关联 Project、Goal、依赖和最近证据后判断具体操作。

## Prerequisites

- 位于 kos Vault 根目录并读取 `90_系统/规则/对象规范.md`。
- 使用独立 `32_任务/` Task 对象，不在 Project 正文维护第二份任务状态。
- 完成、取消、归档和 Project 贡献属于业务事实；信息不足时使用 `ask_question`。

## How to Run

按意图选择确定性操作：

```bash
kos-harness list-task-pool --today YYYY-MM-DD
kos-harness create --kind task --title "任务" --extra '{...}'
kos-harness update-task --input '{"path":"32_任务/任务.md",...}'
kos-harness defer-task --input '{"path":"32_任务/任务.md","deferUntil":"YYYY-MM-DD","reason":"..."}'
kos-harness return-task-to-pool --input '{"path":"32_任务/任务.md","reason":"..."}'
kos-harness complete-task --input '{"path":"32_任务/任务.md","result":"...","outputs":[],"contributions":[]}'
kos-harness archive-task --input '{"path":"32_任务/任务.md"}'
kos-harness transition --path "32_任务/任务.md" --target doing
```

## Quick Reference

1. 读取选中 Task、关联 Goal/Project、依赖、截止时间、推迟历史与完成定义。
2. 用 LLM 判断任务是否可执行、是否需要拆解、排期是否合理、阻塞的真实解除条件和完成证据。
3. 需要用户提供结果、日期、取舍或贡献判断时先提问。
4. 只在判断完成后调用对应 Harness 原子操作。
5. 写入后运行 `kos-harness validate` 并报告实际路径和状态。

## Procedure

### 1. 理解动作与上下文

根据看板 `intent` 区分 create、update、schedule、defer、return-to-pool、block、complete、archive 和 status。不要把按钮名称直接翻译成字段更新；先检查动作是否符合当前状态、Goal 取舍和 Project 事实。

### 2. 补齐语义信息

- 创建或编辑：明确可交付动作、完成定义、截止时间、能量、预计分钟、依赖和 Project 关系。
- 排期或推迟：比较硬承诺、容量、延迟代价和已有今日计划。
- 阻塞：区分现象、原因、依赖与可验证的解除条件。
- 完成：取得非空结果与产物；逐个关联 Project 判断 `strong/supporting/incidental` 并给出证据。
- 状态或归档：确认目标状态符合状态机；关联 Project 的已完成 Task 只有在用户确认后归档。

### 3. 确定性落盘

调用单一对应 Harness 操作，不直接制造第二套状态。Harness 失败时根据校验错误修正输入；不要绕过 Validator 手工写入同一字段。

## Pitfalls

- 不把“做了”当成有证据的完成结果。
- 不按标题相似度推断 Project 贡献。
- 不自动把开放 Task 排入今天或把完成 Task 归档。
- 不把确定性排序冒充 LLM 判断。
- 不在信息不足时猜测推迟日期、阻塞原因或完成证据。

## Verification

- Task 路径、状态、日期和关系符合对象规范。
- 创建和更新体现了 LLM 对可执行性、取舍或证据的判断。
- 完成项包含结果；Project 贡献有逐项证据。
- 状态流转合法且需要的用户确认已经取得。
- `kos-harness validate` 通过。
