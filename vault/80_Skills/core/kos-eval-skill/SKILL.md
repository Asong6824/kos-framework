---
name: kos-eval-skill
description: 运行和维护 kos Skill eval，用 prompt 集、Task Contract、证据判定和受控迭代防止 Skill 调用与任务结果腐化。
version: 1.1.0
metadata:
  hermes:
    tags: [kos, skill, eval, anti-corruption]
    related_skills: [kos-skill-manager, kos-system-check]
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
# kos-eval-skill

## When to Use

当用户希望测试某个 Skill 是否仍然按预期触发、执行关键步骤、遵守路径和输出约定，或在晋升 incubator Skill 前做防腐检查时使用。

## Prerequisites

- 当前工作目录应为包含 `.kos.md`（或兼容的 `.hermes.md`）的 kos vault 根目录。
- 必须读取 `90_系统/evals/README.md`。
- 必须先运行 `kos-harness`。
- 运行 eval 不代表自动修复或自动晋升 Skill；任何正式修改仍需用户确认。

## How to Run

```text
/kos-eval-skill <skill-name>
/kos-eval-skill --all
/kos-eval-skill --validate
```

## Quick Reference

1. 校验 eval 定义。
2. 定位 `90_系统/evals/skills/<skill-name>.prompts.csv`。
3. 运行 `kos-harness skill-eval` 做轻量 Contract Gate。
4. 用 Task Contract 定义任务完成条件，再执行任务。
5. 用确定性证据和 Agent rubric 评估；失败时只在安全范围内迭代。
6. 输出 `pass@1`、`pass@k`、迭代次数、失败项和 artifact。

## Procedure

### Step 1: 校验 Eval 定义

```bash
kos-harness validate
```

如果这里失败，先修复 eval 定义，不要继续解释 Skill 已通过。

### Step 2: 运行指定 Skill Contract Gate

```bash
kos-harness skill-eval --suite <skill-name> --write-artifact
```

例如：

```bash
kos-harness skill-eval --suite kos-bilibili-to-source --write-artifact
```

没有 case 时结果是 `NO_CASES`，不能解释为 eval 通过。

### Step 3: 定义 Task Contract

需要评估实际任务完成度时，先在执行任务之前创建：

```text
90_系统/evals/contracts/<skill-name>/<case-id>.task.yaml
```

Task Contract 至少定义目标、最大迭代次数和确定性检查；有语义质量要求时再增加 rubric：

```yaml
version: 1
id: create-project-basic
skill: kos-create-project
objective: 创建结构完整且可继续推进的 Project
max_iterations: 3
checks:
  - id: project_exists
    type: path_exists
    path: 31_项目/示例项目/示例项目.md
  - id: schema_valid
    type: harness_passes
    validator: schema
rubric:
  - id: actionability
    description: 下一步行动具体且可执行
    min_score: 3
    weight: 1
```

完成条件必须在任务执行前冻结；不要因为本轮失败而降低阈值或删除检查。

### Step 4: 证据驱动评估与受控迭代

Agent 先执行任务，再把语义 rubric 的分数和证据写到临时 YAML。分数没有证据时按失败处理：

```yaml
contract_id: create-project-basic
summary: Project 已创建，但下一步行动仍不够具体
next_action: 仅补充下一步行动，不扩大修改范围
needs_user: false
rubric:
  actionability:
    score: 2
    evidence:
      - 31_项目/示例项目/示例项目.md#当前任务
```

运行评估并累计状态：

```bash
kos-harness task-eval \
  --contract 90_系统/evals/contracts/kos-create-project/create-project-basic.task.yaml \
  --self-assessment /tmp/create-project-basic.assessment.yaml \
  --state 90_系统/evals/artifacts/create-project-basic-run.json \
  --run-id create-project-basic-run
```

状态含义：

- `PASS`：确定性检查和 rubric 全部通过。
- `RETRYABLE`：未通过但仍低于最大迭代次数；按失败证据做最小修正后重评。
- `NEEDS_USER`：需要新权限或人工判断；暂停自动迭代并请求用户输入。
- `EXHAUSTED`：达到最大迭代次数仍未通过；停止并报告。

必须同时报告：

- `pass@1`：第一次是否通过。
- `pass@k`：最大迭代范围内是否收敛。
- 实际迭代次数和每轮失败项。

### Step 5: 运行全部 Contract Eval

```bash
kos-harness skill-eval --write-artifact
```

### Step 6: 解读结果

输出重点：

- `Overall: PASS/FAIL`
- `Score`
- 失败的 case id
- 失败的 check id
- artifact 路径
- Task Completion Run 的 `pass@1`、`pass@k` 和迭代状态

失败时按以下顺序判断：

1. eval case 是否写错。
2. Skill 描述是否触发边界模糊。
3. Skill 是否遗漏关键步骤。
4. Skill 是否仍引用旧路径或旧对象规则。
5. 是否需要新增 harness 脚本来替代纯文字流程。

## Pitfalls

- 不要把 eval 通过等同于内容质量完美；它只是防止关键行为回归。
- 不要只写正例；至少保留一个负例防止误触发。
- 不要让失败 case 消失；真实失败应变成长期回归测试。
- 不要在 eval 脚本里执行高风险外部操作，除非用户明确确认。
- 不要自动重试发送消息、付款、发布、删除或其他不可逆外部操作。
- Task Contract 评估的是本次任务产物；不能由被修改的 Skill 作为修改自身的唯一验证器。
- 自迭代默认只修复本次任务产物。修改 `SKILL.md`、Harness 或受保护状态必须进入独立回归和人工确认流程。

## Verification

- `kos-harness validate` 通过。
- 指定 suite 或全部 suite 有明确 PASS/FAIL 和 score。
- artifact 写入 `90_系统/evals/artifacts/`。
- 失败项能定位到具体 check 和具体 Skill 内容。
- Task Contract 在执行前定义，失败后没有降低完成标准。
- 迭代不超过最大迭代次数，且明确区分 `pass@1` 与 `pass@k`。
