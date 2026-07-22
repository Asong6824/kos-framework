# Runtime Skill Eval 防腐机制

kos 是 Skill 驱动的系统，因此用户在个人 vault 中新建或修改的 Skill 需要被评估、回归测试和防腐。

framework 内置 core Skill 的发布级 eval 属于 kos-framework Development Harness，位于源仓库 `dev/evals/`，不随 runtime vault 分发。

本文档将 eval-driven Skill testing 方法转化为 kos 内部机制：

```text
Contract Gate -> Process Eval -> Task Contract -> evidence -> controlled iteration
```

## 目录

| 路径 | 作用 |
|---|---|
| `skills/*.prompts.csv` | 每个 Skill 的小型 prompt 集，包含正例、反例和上下文噪声 |
| `contracts/**/*.task.yaml` | 执行前定义的任务目标、完成检查、rubric 和最大迭代次数 |
| `artifacts/` | 实际执行后的输出、日志和评分结果 |

## Eval Case 字段

```csv
id,skill,should_trigger,prompt,expected_checks,notes
```

- `id`：稳定测试用例 id。
- `skill`：目标 Skill 名。
- `should_trigger`：`true` / `false`，用于检查触发边界。
- `prompt`：用户可能真实提出的请求。
- `expected_checks`：用 `|` 分隔的检查项。
- `notes`：这个 case 要防止什么退化。

## 检查类型

当前机制分为结构门禁和两层有效性评估：

1. Contract Gate：确定性检查 Skill 存在、scope、pinned、标准章节和关键文件。
2. Process Eval：检查 Agent 是否正确调用 Skill，并遵守执行协议。
3. Task Completion：按预先定义的 Task Contract 判断任务是否完成，以及失败后能否在限定轮次内收敛。

当前 harness 内置轻量 deterministic contract checks：

- Skill 文件是否存在。
- scope / pinned / external_systems 是否正确。
- 是否保留关键防腐规则，例如不写旧路径、不跳过人工确认、不虚构素材。
- 是否保留必要附属文件，例如 `rules/`、`strategies/`、`config/EXTEND.md`。

结构化 schema 和执行器随 kos-agent 安装，不复制到 Vault。

真实 Process Eval 仍需要外部 Agent runner，后续可扩展为：

- 捕获 Hermes/Codex 执行输出。
- 检查命令、文件产物、路径、frontmatter。
- 用结构化 rubric 检查风格和质量。

## Task Contract 与任务完成循环

Task Contract 必须在任务执行前创建，不能因为执行失败而降低标准。最小示例：

```yaml
version: 1
id: create-project-basic
skill: kos-create-project
objective: 创建结构完整的 Project
max_iterations: 3
checks:
  - id: project_exists
    type: path_exists
    path: 31_项目/示例项目.md
  - id: schema_valid
    type: harness_passes
    validator: schema
rubric:
  - id: actionability
    description: 下一步行动具体且可执行
    min_score: 3
```

Agent 执行任务后提交 rubric 分数和具体证据。运行：

```bash
node .obsidian/plugins/kos-companion/kos-agent/dist/kos-harness.mjs task-eval \
  --contract 90_系统/evals/contracts/kos-create-project/create-project-basic.task.yaml \
  --self-assessment /tmp/create-project-basic.assessment.yaml \
  --state 90_系统/evals/artifacts/create-project-basic-run.json \
  --run-id create-project-basic-run
```

结果状态：

- `pass`：全部必需检查和 rubric 通过。
- `retryable`：仍可在最大迭代次数内按证据做最小修正。
- `needs_user`：需要新权限或人工判断，必须暂停自动迭代。
- `exhausted`：已达到最大迭代次数，必须停止并报告。

结果同时保留 `pass@1` 和 `pass@k`，避免反复修补掩盖首次执行质量。

Agent 自评不是自证：没有 evidence 的 rubric 分数按失败处理，确定性检查失败不能被语义分数覆盖。

## 安全边界

- 自迭代只修复当前任务产物，不自动修改 Skill 本身。
- 不自动重试发送、付款、发布、删除或其他不可逆外部操作。
- Runtime Skill 不能作为修改自身的唯一 validator。
- 修改 Skill、Harness 或受保护状态仍需独立回归与用户确认。

## 晋升规则

- `incubator` Skill 晋升为正式目录前，必须至少有一份 eval prompt CSV。
- 用户自建 `integration` Skill 的 eval 应包含至少一个负例，防止误触发。
- `personal` Skill 的 eval 必须覆盖风格或个人偏好边界。
- 每次修改 `SKILL.md` 后，应运行对应 eval，避免行为回归。
