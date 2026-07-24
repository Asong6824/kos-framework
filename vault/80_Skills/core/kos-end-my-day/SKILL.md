---
name: kos-end-my-day
description: 在用户说结束一天、写日报、复盘今天或整理明日继续事项时使用。依据 Task 和每日推荐反馈生成事实型日报，记录接受、完成、推迟、拒绝、实际结果和 Project 贡献，不伪造短周期 Goal 归因。
version: 2.0.0
metadata:
  hermes:
    tags: [kos, diary, daily-review]
    related_skills: [kos-start-my-day, kos-review-period]
    pinned: true
  kos:
    scope: core
    lifecycle: active
    created_by: human
    promoted: true
    review_required: false
    object_types: [diary, task, project, goal]
    external_systems: []
---
# kos-end-my-day

## When to Use

用户结束当天工作、要求日报或希望整理未完成原因与明日继续事项时使用。

## Prerequisites

- 位于 kos Vault 根目录。
- 优先存在 `00_工作台/计划/YYYY-MM-DD.md`；没有时仍可从 Task 事实生成日报。
- Task 完成必须先通过 `complete-task` 记录结果和逐 Project 贡献。

## How to Run

```bash
kos-harness end-day --date YYYY-MM-DD
```

## Quick Reference

1. 汇总接受、调整、完成、推迟和拒绝的 Task。
2. 引用实际结果、产物和 Project 贡献证据。
3. 记录未完成原因与明日继续，保留人工补充区。
4. 只给 Goal 投入提示，不做单日伪精确归因。
5. 列出已完成且关联 Project 的归档候选，只提醒用户确认，不自动移动。
6. 运行 Harness。

## Procedure

先由 LLM 阅读当天计划、Task 结果、推荐反馈、Project 变化和最近日记，区分事实、推断和需要用户补充的内容。确认所有声称完成的 Task 已写入非空 `result`；关联多个 Project 时逐个判断 strong/supporting/incidental。信息不足时使用 `ask_question`，不要只运行模板生成。

随后调用 `end-day`，把结构化事实写入 `40_日记/YYYY/MM/YYYY-MM-DD.md`。LLM 对未完成原因、判断变化、Reflection 候选和明日继续提出有证据的建议，但主观感受和用户结论必须等待确认，并保留 `<!-- 人手动添加 -->` 区块，不替用户编写成既成事实。

日报完成后读取 `list-task-pool` 的 `archiveCandidates`。只有用户确认时才调用 `archive-task`，归档到 `32_任务/归档/<完成年份>/`；不能因为 Task 已完成就自动移动。

## Pitfalls

- 不用 Task 完成数量证明 Goal 成功。
- 不把 proposed 或 rejected 建议写成已接受计划。
- 不因存在 Project 链接就自动增加 Project 进度。
- 不覆盖人工填写区。

## Verification

- Diary 路径和 `type: diary` 正确。
- 日报分开列出完成、推迟、拒绝和仍在计划中的 Task。
- 完成项能追溯到 Task 结果与贡献证据。
- Goal 仅显示趋势提示。
- `kos-harness validate` 通过。
