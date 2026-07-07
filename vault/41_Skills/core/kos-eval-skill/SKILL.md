---
name: kos-eval-skill
description: 运行和维护 kos Skill eval，用 prompt 集、确定性检查和 artifacts 防止 Skill 触发边界和行为腐化。
version: 1.0.0
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
- 必须先运行 `90_系统/harness/validate_skill_evals.py`。
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
3. 运行 `run_skill_evals.py` 做轻量确定性检查。
4. 需要留档时写入 `90_系统/evals/artifacts/`。
5. 输出分数、失败 case 和建议修复方向。

## Procedure

### Step 1: 校验 Eval 定义

```bash
python3 90_系统/harness/validate_skill_evals.py --format markdown
```

如果这里失败，先修复 eval 定义，不要继续解释 Skill 已通过。

### Step 2: 运行指定 Skill Eval

```bash
python3 90_系统/harness/run_skill_evals.py --suite <skill-name> --write-artifact
```

例如：

```bash
python3 90_系统/harness/run_skill_evals.py --suite kos-bilibili-to-source --write-artifact
```

### Step 3: 运行全部 Eval

```bash
python3 90_系统/harness/run_skill_evals.py --write-artifact
```

### Step 4: 解读结果

输出重点：

- `Overall: PASS/FAIL`
- `Score`
- 失败的 case id
- 失败的 check id
- artifact 路径

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

## Verification

- `validate_skill_evals.py` 通过。
- 指定 suite 或全部 suite 有明确 PASS/FAIL 和 score。
- artifact 写入 `90_系统/evals/artifacts/`。
- 失败项能定位到具体 check 和具体 Skill 内容。
