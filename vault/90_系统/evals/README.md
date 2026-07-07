# Runtime Skill Eval 防腐机制

kos 是 Skill 驱动的系统，因此用户在个人 vault 中新建或修改的 Skill 需要被评估、回归测试和防腐。

framework 内置 core Skill 的发布级 eval 属于 kos-framework Development Harness，位于源仓库 `dev/evals/`，不随 runtime vault 分发。

本文档将 eval-driven Skill testing 方法转化为 kos 内部机制：

```text
prompt -> captured run / artifacts -> deterministic checks -> rubric score -> regression record
```

## 目录

| 路径 | 作用 |
|---|---|
| `skills/*.prompts.csv` | 每个 Skill 的小型 prompt 集，包含正例、反例和上下文噪声 |
| `schemas/skill_eval_result.schema.json` | eval 结果的结构化输出 schema |
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

当前评估分两层：

1. Contract eval：确定性检查 Skill 存在、scope、pinned、标准章节和关键文件。
2. Behavior eval：用正例、负例和真实 Agent run 检查触发边界与实际产物。

当前 harness 内置轻量 deterministic contract checks：

- Skill 文件是否存在。
- scope / pinned / external_systems 是否正确。
- 是否保留关键防腐规则，例如不写旧路径、不跳过人工确认、不虚构素材。
- 是否保留必要附属文件，例如 `rules/`、`strategies/`、`config/EXTEND.md`。

真实 behavior eval 需要外部 Agent runner，后续可扩展为：

- 捕获 Hermes/Codex 执行输出。
- 检查命令、文件产物、路径、frontmatter。
- 用结构化 rubric 检查风格和质量。

## 晋升规则

- `incubator` Skill 晋升为正式目录前，必须至少有一份 eval prompt CSV。
- 用户自建 `integration` Skill 的 eval 应包含至少一个负例，防止误触发。
- `personal` Skill 的 eval 必须覆盖风格或个人偏好边界。
- 每次修改 `SKILL.md` 后，应运行对应 eval，避免行为回归。
