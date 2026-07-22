---
name: kos-system-check
description: 使用 kos-agent Harness 检查 Vault 目录、对象、Skill 与 Eval 定义。
version: 2.0.0
metadata:
  hermes:
    tags: [kos, harness, validation]
    related_skills: [kos-start-my-day]
    pinned: true
  kos:
    scope: core
    lifecycle: active
    created_by: human
    promoted: true
    review_required: false
    object_types: []
    external_systems: []
---
# kos-system-check

## When to Use

当用户希望检查 kos 健康状态，或修改对象、模板、Skill、规则和 Eval 定义后需要确定性验收时使用。

## Prerequisites

- 当前目录是包含 `.kos.md` 的 Vault 根目录。
- 已安装 kos-agent，且 `kos-harness` 可执行。
- 不需要模型或网络。

## How to Run

```bash
kos-harness validate
```

机器读取结果时：

```bash
kos-harness validate --format json
```

## Quick Reference

1. 运行统一 validator。
2. 按 `paths/schema/state/skills/skill_evals` 分类 findings。
3. 只修复明确报错的文件。
4. 如果修改了 Skill，继续运行 Skill Eval。
5. 如果任务有 Task Contract，继续运行 Task Completion。

## Procedure

### Step 1: 全量验证

运行 `kos-harness validate`。系统检查 Vault 必需目录、对象路径、frontmatter schema、状态、Skill metadata 和 `90_系统/evals/contracts` 定义。

YOLO 是唯一执行模式，因此不存在 permission mode validator。需要人工判断的内容通过 `ask_question` 和 Task Contract 的 `needs_user` 表达。

### Step 2: Skill Eval

```bash
kos-harness skill-eval --write-artifact
```

指定单个 suite：

```bash
kos-harness skill-eval --suite <skill-name> --write-artifact
```

### Step 3: Task Completion

```bash
kos-harness task-eval \
  --contract "90_系统/evals/contracts/<name>.task.yaml" \
  --self-assessment "/tmp/assessment.yaml" \
  --state "/tmp/run.json"
```

Task Completion 记录 pass@1、pass@k、最大迭代次数和 `needs_user`。

## Pitfalls

- 不要寻找或重建 kos-agent 安装包中的 `kos-harness`；可执行 Harness 属于 kos-agent。
- 不要把 Runtime Skill 当成自身唯一 validator。
- 不要因为 Eval 失败而降低既有 Task Contract 标准。
- validator 通过不等于语义质量已经通过人工审阅。

## Verification

- `kos-harness validate` 返回 0。
- JSON 输出的 `passed` 为 `true` 且 `errorCount` 为 0。
- Skill Eval 和 Task Completion 的结果写入 `90_系统/evals/artifacts/` 或指定 state 文件。
- Vault 内不存在 runtime Python、Eval engine 或重复 schema。
