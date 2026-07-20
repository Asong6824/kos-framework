# Vault 能力迁移到 kos-agent

## 1. 决策

`vault/90_系统/harness/` 中的 runtime scripts、schemas、Validator、Task Contract evaluator 和用户 Skill Eval runtime 全部迁入 kos-agent。

迁移完成后的原则：

- 用户 Vault 保存知识、对象规范、模板、Skills 和用户定义的 Eval case。
- 可执行代码、machine constraints、tooling 和 runtime Eval engine 由 kos-agent 分发。
- 确定性能力仍提供 library/CLI 入口，不要求调用 LLM。
- Obsidian 调用 kos-agent，不再用 TypeScript 或 Python 重复实现同一创建、流转和校验逻辑。
- `dev/harness/`、`dev/tests/` 和发布 Eval 继续属于 framework development，不迁入用户 runtime。

## 2. 目标目录

```text
agent/packages/kos-agent/src/kos/
  contracts/         # schema loader、对象状态和结构契约
  operations/        # create/update/generate 等确定性操作
  validation/        # paths/schema/state/skills 等 Validator
  workflows/         # daily brief、dashboard、kickoff、research 等编排
  evals/             # Task Contract 和用户 Skill Eval runtime
  cli/               # 无 LLM 的确定性命令入口
  context/           # 向 Agent 暴露规则、模板、Skill 和结果
  feedback/          # 把 Validator/Eval 结果返回 Agent 与 UI
```

## 3. 迁移矩阵

| 当前能力 | 当前路径 | kos-agent 目标 | 迁移结果 |
|---|---|---|---|
| 对象 schemas | `harness/schemas/*.yaml` | `kos/contracts/` | agent package 成为机器契约实现 |
| 公共 frontmatter/path helpers | `harness_common.py` | `kos/contracts/` + `kos/operations/` | TypeScript 单一实现 |
| `create_*` | `harness/create_*.py` | `kos/operations/` | library + CLI，供 Agent/插件复用 |
| `update_project.py` | `harness/` | `kos/operations/` | 通用 update 操作，不保留人工权限门禁 |
| `generate_*` | `harness/generate_*.py` | `kos/workflows/` | Agent workflow + deterministic CLI |
| `summarize_source.py` | `harness/` | 语义部分归 Agent，结构部分归 operations | 删除脚本内硬编码模型语义 |
| `validate_paths/schema/state` | `harness/` | `kos/validation/` | 确定性 Validator |
| `validate_permissions.py` | `harness/` | 不迁移权限门禁 | 删除强制人工确认；只保留结构/证据一致性检查 |
| `validate_skills/evals` | `harness/` | `kos/validation/` + `kos/evals/` | runtime engine 进入 agent |
| `run_skill_evals.py` | `harness/` | `kos/evals/` | 读取 Vault 用户 case，执行器在 agent |
| `evaluate_task_contract.py` | `harness/` | `kos/evals/` | Agent feedback loop 原生能力 |
| Python health report | `harness/` | `kos/validation/` + CLI | Obsidian 原生展示结构化结果 |
| 插件创建向导 | `ob-plugin/src/actions/create.ts` | 调用 kos-agent operations | 删除与 Python/agent 重复逻辑 |
| 插件状态流转 | `ob-plugin/src/actions/transition.ts` | 调用 kos-agent operations | 看板只发送用户意图并刷新索引 |
| 插件 health bridge | `ob-plugin/src/bridge/harness.ts` | kos-agent RPC | 删除 Python child process bridge |

### 当前实现状态（2026-07-20）

- 15 份对象 schema（含补齐的 task schema）已复制到 `src/kos/validation/schemas/` 并作为 kos-agent 构建资产分发。
- `paths/schema/state` 已用 TypeScript 实现；状态检查不包含 legacy 人工审批警告。
- `skills/skill_evals` 定义检查已用 TypeScript 实现，Eval CSV 使用锁定的 MIT `csv-parse@7.0.1`，Task Contract 使用现有 YAML parser 和显式规则。
- `edit/write` 成功后自动运行相关对象、Skill 或 Eval validator；ERROR 会把 tool result 标记失败并返回模型修正。
- kos-agent RPC 已增加系统级 `validate` command。它不是模型 tool；Obsidian 健康检查和 Agent 侧栏使用该 command 展示结构化结果。
- `create_object` 与 `transition_status` deterministic operations 已进入 kos-agent RPC，包含路径限制、模板读取、原子写入、合法状态图、证据要求、写后验证和失败回滚。
- Obsidian Desktop 的创建向导、状态徽章、流转命令和审核中心已调用 kos-agent operations；移动端因无法运行本地 host，暂保留 Obsidian API fallback。
- kos-agent 默认加载 Vault 根 `.kos.md` 与 `41_Skills/`，产品 system prompt 已从 Pi coding assistant 语义改为 kos Harness 语义。
- Python 与 TypeScript parity fixture 已覆盖路径、字段、状态错误。预期差异包括：移除人工审核警告，以及去除旧 schema validator 对非法 required 值的重复报错。
- 旧 Python 仍保留并参与 `release-check`，待 operations/eval runtime 迁移和更多 fixture 完成后统一删除。

## 4. YOLO 对 legacy 权限的处理

当前对象规范、Skills 和 `validate_permissions.py` 把部分状态定义为“AI 不得修改、必须人确认”。目标 kos-agent 不继承这一权限模型：

- Agent 可以自主更新所有合法对象状态。
- 状态仍必须符合 schema、状态集合和领域证据要求。
- 人工审阅是可选工作流，不是 machine gate。
- 需要审阅时，Agent 发出 `ask_question` 并等待用户回答，然后继续更新。
- `human_confirmed`、`confirmed_by` 等字段可以作为历史或审计信息，但不再是状态合法性的必要条件。

迁移时需要同步修改对象规范、core Skills、用户文档、Validator 和测试，不能只删除一个 Python 检查。

## 5. 迁移顺序

1. 导入并跑通 Pi 三个 package，建立 `packages/kos-agent`。
2. 在 kos-agent 中建立 contracts、operations、validation 和 CLI 边界。（validation、create/transition operations 与 RPC 已完成首版）
3. 逐个移植 Validator，以同一 fixture 对比 Python 与 TypeScript 结果。（paths/schema/state/skills/skill_evals 已完成首版）
4. 移植 create/update/generate operations，处理现有语义逻辑混入脚本的问题。（create 与通用状态流转已完成；generate workflows 待迁移）
5. 移植 Task Contract 和用户 Skill Eval runtime。
6. 修改对象规范和 Skills，取消强制人工确认，加入可选 review/`ask_question` 语义。
7. 让 Obsidian 看板和 Agent UI 统一调用 kos-agent。
8. parity tests 全部通过后，从 runtime distribution 删除 `vault/90_系统/harness/`。
9. 删除插件中的重复 TypeScript operations 和 legacy Python bridge。

## 6. 迁移期间的兼容规则

- 在 kos-agent 对应能力尚未通过 parity test 前，现有 Python runtime 继续工作。
- 同一能力切换后只能有一个写入实现；旧入口转发到 kos-agent 或移除，不能长期双写。
- Vault schema 和模板变更必须同时验证旧 fixture 与新 kos-agent operation。
- 迁移期间文档要标明 current implementation 与 target implementation，避免把 legacy 权限当成新产品要求。

## 7. 完成标准

- 干净 Vault 不依赖 `90_系统/harness/*.py` 即可完成创建、更新、生成和检查。
- 所有确定性能力可以通过 kos-agent CLI 在无 LLM 情况下执行。
- Obsidian 不再复制对象创建、状态流转和 Validator 逻辑。
- Agent 工具执行、Validator 结果和看板刷新形成一个事件闭环。
- 原有 runtime fixtures 和新 kos-agent tests 行为一致，明确取消的人工权限检查除外。
- runtime distribution 不再包含 Python Harness 源码和 machine schemas。
