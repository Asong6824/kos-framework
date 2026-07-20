---
name: kos-skill-manager
description: 管理 kos Skill 的分类、孵化、晋升、合并和归档，确保 Agent 新建能力先进入 incubator。
version: 1.1.0
metadata:
  hermes:
    tags: [kos, skill, governance]
    related_skills: [kos-system-check, kos-create-method]
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
# kos-skill-manager

## When to Use

当用户希望整理、检查、迁移、晋升、合并、归档或新建 kos Skill 时使用。尤其适用于 Hermes Agent 生成了候选 Skill，需要判断它应该进入 `core`、`integrations`、`personal`，还是继续留在 `incubator`。

## Prerequisites

- 当前工作目录应为包含 `.kos.md`（或兼容的 `.hermes.md`）的 kos vault 根目录。
- 必须读取 `.kos.md`；Hermes 环境下同时读取 `.hermes.md`、`41_Skills/README.md` 和 `90_系统/规则/对象规范.md`。
- 任何从 `incubator` 晋升到正式目录的操作都必须得到用户明确确认。
- 不要把旧 OrbitOS Skill 原样复制进 `core`；必须先判断职责边界和 kos 对象关系。

## How to Run

用户输入：

```text
/kos-skill-manager scan
/kos-skill-manager review <skill-name>
/kos-skill-manager promote <skill-name>
/kos-skill-manager archive <skill-name>
```

## Quick Reference

1. 扫描 `41_Skills/` 下所有 `SKILL.md`。
2. 检查 frontmatter 是否包含 `metadata.hermes` 和 `metadata.kos`。
3. 根据职责边界判断 scope：`core` / `integration` / `personal` / `incubator` / `archived`。
4. 检查候选 Skill 是否重复已有正式 Skill。
5. 检查是否存在对应 Skill eval，并运行必要的轻量检查。
6. 输出 promote / merge / archive / keep-in-incubator 建议。
7. 只有用户明确确认后，才移动目录或修改 `promoted`、`scope`、`lifecycle`。

## Procedure

### Step 1: 扫描 Skill

检查以下目录：

```text
41_Skills/core/
41_Skills/integrations/
41_Skills/personal/
41_Skills/incubator/
41_Skills/archived/
```

每个 Skill 必须满足：

- 目录内存在 `SKILL.md`。
- frontmatter 有 `name`、`description`、`version`。
- `metadata.hermes.pinned` 存在。
- `metadata.kos.scope`、`metadata.kos.lifecycle`、`metadata.kos.review_required` 存在。

### Step 2: 判断 Scope

按以下规则分类：

| scope | 判断标准 |
|---|---|
| `core` | 直接维护 kos 核心对象生命周期，缺失会影响主流程 |
| `integration` | 连接外部平台、工具、API 或内容源，并把结果转入 kos |
| `personal` | 用户个人偏好、写作风格、研究习惯、创作流程 |
| `incubator` | 未审核、实验中、Agent 新建或职责尚不清楚 |
| `archived` | 废弃、冻结、历史保留或被新 Skill 替代 |

### Step 3: 检查晋升条件

从 `incubator` 晋升前必须确认：

- 是否有明确使用场景。
- 是否与已有 Skill 重复。
- 是否需要 harness 脚本支撑。
- 是否会写入 kos 对象；如果会，是否遵守对象规范。
- 是否需要外部系统；如果需要，是否声明 `external_systems`。
- 是否应该只是 `Method`，而不是可执行 Skill。
- 是否存在 `90_系统/evals/skills/<skill-name>.prompts.csv`。
- eval 是否覆盖正例、负例和关键防腐规则。
- 如果 Skill 会创建或修改产物，是否存在 `90_系统/evals/contracts/<skill-name>/*.task.yaml` 并定义最大迭代次数。

### Step 4: 晋升或归档

推荐目标路径：

```text
41_Skills/core/<skill-name>/SKILL.md
41_Skills/integrations/<external_system>/<skill-name>/SKILL.md
41_Skills/personal/<domain>/<skill-name>/SKILL.md
41_Skills/archived/<skill-name>/SKILL.md
```

晋升时更新：

```yaml
metadata:
  kos:
    scope: core|integration|personal
    lifecycle: active
    promoted: true
    review_required: false
```

归档时更新：

```yaml
metadata:
  hermes:
    pinned: false
  kos:
    scope: archived
    lifecycle: archived
    review_required: false
```

### Step 5: 验证

晋升、合并或归档后运行：

```bash
python3 90_系统/harness/validate_paths.py
python3 90_系统/harness/validate_schema.py
python3 90_系统/harness/validate_state.py
python3 90_系统/harness/validate_permissions.py
python3 90_系统/harness/generate_health_report.py
```

## Pitfalls

- 不要让 Agent 直接创建正式 `core` Skill。
- 不要把个人写作、翻译、创作偏好混入 `core`。
- 不要把外部平台接入混入 `core`；应放入 `integrations`。
- 不要把尚未实践过的方法直接做成正式 Skill；可以先创建 Method candidate。
- 不要只因为旧 Skill 高频使用就认为它属于 kos 框架核心。

## Verification

- 所有正式 Skill 都有 `metadata.kos.scope`。
- `core` Skill 均为 `pinned: true`。
- `integration` Skill 声明了 `external_systems`。
- `incubator` Skill 均为 `promoted: false` 且 `review_required: true`。
- 没有未经确认的候选 Skill 被移入正式目录。
