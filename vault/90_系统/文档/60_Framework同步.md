# Framework 同步

个人 kos vault 是运行时工作区。`kos-framework` 是上游框架源码。同步的目标是让个人 vault 接收框架更新，同时保留个人内容、个人 Skill 和运行产物。

## 同步方向

```text
kos-framework/vault/ -> personal kos vault
```

不要反向把个人 vault 的内容整体复制回 framework。能回流到 framework 的，应该是已经通用化的 core 规则、模板、文档、Harness 或 Skill。

## Framework 管理的路径

同步工具会管理：

```text
.kos.md
.hermes.md
AGENTS.md
CLAUDE.md
README.md
25_个人操作画像/        # 只补框架目录占位，个人画像内容保留
41_Skills/README.md
41_Skills/core/
90_系统/规则/
90_系统/模板/
90_系统/harness/
90_系统/evals/README.md
90_系统/evals/contracts/
90_系统/evals/schemas/
90_系统/evals/skills/
90_系统/工作流/
90_系统/文档/
```

其中只有 `41_Skills/core/` 是权威删除路径。其他目录会更新 framework 文件，但保留目标 vault 里的额外文件。

## 不会同步或不应覆盖的内容

以下内容属于个人 vault：

- `00_工作台/` 中的运行状态。
- `10_收件箱/` 和 `11_原材料/` 的个人输入。
- `21_研究/`、`22_知识库/`、`23_日记/`、`24_认知记录/`、`30_项目/`、`31_任务/`、`40_方法库/`。
- `25_个人操作画像/` 中的画像内容。
- `41_Skills/integrations/`、`41_Skills/personal/`、`41_Skills/incubator/`、`41_Skills/archived/`。
- `90_系统/harness/reports/`。
- `90_系统/evals/artifacts/`。

根目录的 `.kos.md`、`.hermes.md`、`AGENTS.md` 和 `CLAUDE.md` 是 runtime adapter 入口，由 framework 管理。个人后端配置、账号、profile 或长期偏好不要写进这些入口文件，应放在对应 agent 的外部配置或个人 vault 内容中。

## 预览同步

在 `kos-framework` 源仓库运行：

```bash
python3 dev/harness/compare_vault.py /path/to/personal/kos
python3 dev/harness/sync_to_vault.py /path/to/personal/kos
```

默认是 dry run，不会改文件。

## 应用同步

确认 diff 后运行：

```bash
python3 dev/harness/sync_to_vault.py /path/to/personal/kos --apply
```

应用前会为将被修改或删除的文件创建备份：

```text
90_系统/framework-backups/
```

同步完成后会更新：

```text
90_系统/framework.yaml
```

## 个人需求如何回流

个人使用中发现新需求时，先判断它属于哪一层：

- 通用对象、目录、规则、模板、core Skill：回到 `kos-framework/vault/` 修改。
- 外部平台接入：先放个人 vault 的 `41_Skills/integrations/`，稳定后再判断是否适合提炼。
- 个人写作、翻译、研究偏好：保留在 `41_Skills/personal/`。
- 未验证的新能力：先放 `41_Skills/incubator/`。

回流到 framework 前应补文档、Harness 或 eval，并运行 release check。
