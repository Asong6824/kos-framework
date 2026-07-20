# Skill 评估两层模型与 Task Completion Loop

## 1. 决策

kos Skill 的有效性评估采用“两层 + 结构门禁”模型：

```text
L0 Contract Gate：Skill 和 eval 定义是否满足静态合同
L1 Process Eval：Agent 是否在预期场景调用 Skill，并遵守执行协议
L2 Task Completion：任务是否完成；失败后是否在受控范围内收敛
```

长期目标贡献不作为 framework release 的正式门禁。它依赖个人目标、延迟反馈和因果归因，现阶段可以作为个人 runtime 的可选观察数据，但不能混入 core 发布分数。

## 2. 为什么保留 L0

现有确定性 checker 能低成本发现 scope、pinned、标准章节、关键路径、人工确认规则和附属文件退化。这些检查仍然有价值，但只能证明静态合同存在，不能证明 Agent 真实触发或完成任务。

L0 因此是前置门禁，不计作 Skill 的任务有效性。

## 3. L1 Process Eval

L1 包含两个问题：

1. 路由：应触发时是否触发，不应触发时是否避免触发。
2. 执行合规：是否调用正确 Harness、执行必要步骤、遵守人工确认和禁止操作边界。

目标指标包括 trigger precision / recall、必需步骤覆盖率、禁止行为发生率和人工确认合规率。

当前 framework development 层已实现 Pi runner 和 trace adapter：它在临时 `kos-test` 中执行 checked-in prompt，把 Pi JSON 事件归一化为 Skill 读取、工具调用、命令和错误状态，再按 `dev/evals/process/*.process.yaml` 判分。Runtime Harness 本身仍不启动 Agent；其他后端 adapter 也尚未实现。

## 4. L2 Task Completion

任务完成条件必须在执行前以 Task Contract 固定。Contract 包含：

- objective；
- maximum iterations；
- deterministic checks；
- 可选 semantic rubric；
- 必需和非必需检查。

Agent 执行任务后提交带证据的 rubric 自评。Harness 负责确定性检查和最终汇总。分数没有证据时按失败处理，确定性失败不能被语义评分覆盖。

每轮结果累计为 Task Completion Run，并至少报告：

- `pass@1`：首次执行成功率；
- `pass@k`：最大迭代范围内的收敛率；
- iterations；
- best score；
- 每轮失败项和 next action。

## 5. 自迭代边界

任务内自迭代只允许修复当前任务产物，并遵守：

- 完成标准不能在失败后降低；
- 每次只做与失败证据对应的最小修正；
- 不超过 Contract 的最大迭代次数；
- 不自动重试发送、付款、发布、删除等不可逆外部操作；
- 需要新权限或人工判断时返回 `NEEDS_USER`，不猜测授权。

Skill 自身演进是另一条流程。Agent 可以把真实失败转为 case、生成修改草案，但被修改的 Runtime Skill 不能作为自身唯一验证器；正式修改仍需独立 eval、Development Harness 和人工治理。

## 6. 当前实现

Runtime 新增：

- `90_系统/evals/contracts/**/*.task.yaml`；
- `task_contract.schema.json`；
- `task_eval_result.schema.json`；
- `task_eval_common.py`；
- `evaluate_task_contract.py`。

Framework Development 新增：

- `dev/evals/process/*.process.yaml`；
- Process Eval contract、agent trace 和 result schema；
- `process_eval_common.py`；
- `validate_process_evals.py`；
- `run_process_evals.py` 的 Pi backend adapter。

Task evaluator 支持路径存在/不存在、glob 数量、文本包含/禁止、frontmatter 字段和允许列表内的 validation Harness。Runtime evaluator 不启动 Agent；真实 Pi Process Eval 由 Development Harness 在一次性 `kos-test` fixture 中执行。

## 7. 后续工作

1. 为 Codex、Claude Code、Hermes 实现 runner adapter。
2. 扩展需要人工确认的事件语义和前后顺序约束。
3. 为更多 core Skill 增加正例、负例和过程合同。
4. 为 core Skill 补任务结果合同和 `pass@1/pass@k` 基线。
5. 建立不同 backend/model 指纹的可比基线。
