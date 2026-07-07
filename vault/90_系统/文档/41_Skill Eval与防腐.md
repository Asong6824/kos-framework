# Skill Eval 与防腐

kos 是 Skill 驱动的系统。Skill 一旦变宽、变窄或遗漏关键步骤，Agent 的行为就会漂移。Skill eval 用来把这种漂移变成可检查的回归问题。

## Eval 检查什么

Skill eval 主要检查：

- 该触发时是否触发。
- 不该触发时是否避免误触发。
- 是否保留关键路径和对象规则。
- 是否遵守人工确认边界。
- 是否仍引用正确模板、规则和 Harness。

Eval 不保证内容质量完美，它只保护关键行为不退化。

## 目录结构

```text
90_系统/evals/
  README.md
  schemas/
  skills/
    <skill-name>.prompts.csv
  artifacts/
```

`skills/` 存放用户自建或修改 Skill 的 prompt 测试集。`artifacts/` 存放运行结果，不应手工维护。

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
python3 90_系统/harness/validate_skill_evals.py --format markdown
```

运行全部 eval：

```bash
python3 90_系统/harness/run_skill_evals.py --write-artifact
```

运行单个 suite：

```bash
python3 90_系统/harness/run_skill_evals.py --suite <skill-name> --write-artifact
```

## 何时必须补 Eval

以下情况必须补 eval：

- 新建 `incubator` Skill。
- 修改已有 `SKILL.md` 的 description、scope、步骤或输出约束。
- 将 incubator Skill 晋升为 `core`、`integrations` 或 `personal`。
- 接入外部系统或个人风格约束。
- 发现一次真实误触发、漏触发或路径写错。

## 晋升规则

`incubator` Skill 晋升前必须：

- 有正例。
- 有至少一个负例。
- 覆盖最容易腐化的关键步骤。
- eval 定义检查通过。
- 运行结果可解释。
- 用户明确确认。

Agent 可以创建 eval 草稿，但不能因为 eval 通过就自行晋升 Skill。
