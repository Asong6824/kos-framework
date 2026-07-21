# Skill Eval 与防腐

kos 是 Skill 驱动的系统。Skill 一旦变宽、变窄或遗漏关键步骤，Agent 的行为就会漂移。Skill eval 用来把这种漂移变成可检查的回归问题。

## Eval 检查什么

Skill eval 使用“结构门禁 + 两层有效性评估”：

- Contract Gate：是否保留 metadata、标准章节、关键路径、对象规则和人工确认边界。
- Process Eval：该触发时是否触发、不该触发时是否避免误触发，以及是否按协议执行。
- Task Completion：任务是否满足预先定义的完成条件；失败后是否能在限定轮次内收敛。

当前内置 Harness 已支持 Contract Gate 和 Task Completion 的证据判定。真实 Process Eval 仍需要外部 Agent runner，不能把 prompt CSV 的静态检查解释为真实触发结果。

## 目录结构

```text
90_系统/evals/
  README.md
  schemas/
  skills/
    <skill-name>.prompts.csv
  contracts/
    <skill-name>/
      <case-id>.task.yaml
  artifacts/
```

`skills/` 存放用户自建或修改 Skill 的 prompt 测试集。`artifacts/` 存放运行结果，不应手工维护。

`contracts/` 存放 Task Contract：在任务执行前冻结目标、完成检查、语义 rubric 和最大迭代次数。

## Prompt CSV

每个 eval CSV 使用以下表头：

```csv
id,skill,should_trigger,prompt,expected_checks,notes
```

字段含义：

- `id`：稳定 case id。
- `skill`：目标 Skill 名。
- `should_trigger`：`true` 或 `false`。
- `prompt`：真实用户请求或噪声请求。
- `expected_checks`：用 `|` 分隔的检查项。
- `notes`：这个 case 要防止什么退化。

## 运行 Eval

先检查 eval 定义：

```bash
kos-harness validate
```

运行全部 eval：

```bash
kos-harness skill-eval --write-artifact
```

运行单个 suite：

```bash
kos-harness skill-eval --suite <skill-name> --write-artifact
```

没有 case 时 runner 返回 `NO_CASES`，不能视为通过。

## Task Completion Loop

Task Contract 最小结构：

```yaml
version: 1
id: create-project-basic
skill: kos-create-project
objective: 创建结构完整的 Project
max_iterations: 3
checks:
  - id: project_exists
    type: path_exists
    path: 30_项目/示例项目.md
  - id: schema_valid
    type: harness_passes
    validator: schema
rubric:
  - id: actionability
    description: 下一步行动具体且可执行
    min_score: 3
```

Agent 完成任务后提交带证据的 rubric 自评，再运行：

```bash
kos-harness task-eval \
  --contract 90_系统/evals/contracts/kos-create-project/create-project-basic.task.yaml \
  --self-assessment /tmp/create-project-basic.assessment.yaml \
  --state 90_系统/evals/artifacts/create-project-basic-run.json \
  --run-id create-project-basic-run
```

失败后只根据失败证据做最小修正，然后用同一个 state 重评。达到 `max_iterations` 后必须停止。

如果需要新权限或人工判断，自评中设置 `needs_user: true`，状态会变为 `NEEDS_USER` 并暂停自动迭代。

结果必须区分：

- `pass@1`：第一次执行是否通过。
- `pass@k`：最大迭代范围内是否收敛。
- `iterations`：实际评估轮次。

Agent 自评不等于自证：rubric 没有 evidence 时失败，确定性检查失败不能被语义分数覆盖。

## 何时必须补 Eval

以下情况必须补 eval：

- 新建 `incubator` Skill。
- 修改已有 `SKILL.md` 的 description、scope、步骤或输出约束。
- 将 incubator Skill 晋升为 `core`、`integrations` 或 `personal`。
- 接入外部系统或个人风格约束。
- 发现一次真实误触发、漏触发或路径写错。
- 发现任务未完成、需要返工或多轮才能收敛。

## 晋升规则

`incubator` Skill 晋升前必须：

- 有正例。
- 有至少一个负例。
- 覆盖最容易腐化的关键步骤。
- eval 定义检查通过。
- 运行结果可解释。
- 用户明确确认。

Agent 可以创建 eval 草稿，但不能因为 eval 通过就自行晋升 Skill。

自迭代默认只修改当前任务产物。发送、付款、发布、删除等不可逆操作不能自动重试；修改 Skill 本身必须进入独立回归，且被修改的 Skill 不能作为自己的唯一 validator。
