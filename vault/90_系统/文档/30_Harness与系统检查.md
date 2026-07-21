# kos-agent Harness 与系统检查

kos-agent 是 kos 的官方 Agent 产品。Agent = LLM + Harness；模型以外的模型接入、agent loop、上下文、工具、Skill、session、权限策略、验证、Eval、反馈和 Obsidian UI 都属于 Harness。

Vault 只保存用户数据、规则、模板、Skill 和 Eval 定义，不分发可执行脚本。所有 runtime validator、对象操作、Task Completion 和 Skill Eval 执行器均由 kos-agent 提供。

## 执行策略

kos-agent 只有 YOLO 模式。读写文件和执行命令不需要逐步审批；需要用户判断时，Agent 使用 `ask_question` 暂停并在对话框中等待回答。

系统负责可确定判断：

- Vault 边界和路径合法性。
- frontmatter schema 与状态机。
- 原子写入、回滚和跨文件回链。
- Skill/Eval 合同结构。
- Task Contract 的确定性检查、迭代状态和 pass@k。

模型负责语义判断：

- 内容理解、研究、摘要和表达。
- rubric 自评与证据说明。
- 何时需要用户审阅或补充信息。

## CLI

`kos-harness` 是 kos-agent 随包提供的无 LLM CLI，可用于 CI、自动化和故障排查。

```bash
kos-harness validate
kos-harness skill-eval --suite <skill-name> --write-artifact
kos-harness task-eval --contract <contract.task.yaml> --state <run.json>
```

对象和工作流命令：

```bash
kos-harness create --kind project --title "项目名"
kos-harness transition --path "30_项目/项目名.md" --target active
kos-harness update-project --query "项目名" --input '{"progress":["完成一项工作"]}'
kos-harness process-source --kind extract --query "来源标题"
kos-harness process-source --kind summary --query "来源标题"
kos-harness daily-dashboard
kos-harness daily-brief
kos-harness diary
```

命令失败时返回非零退出码；结构化集成使用 `--format json`。

## Eval 数据

用户 Eval 数据继续位于 Vault：

```text
90_系统/evals/contracts/   # Task Contract
90_系统/evals/skills/      # Skill prompt cases
90_系统/evals/artifacts/   # 执行结果
```

Eval schema 和执行器属于 kos-agent 安装包，不在 Vault 中复制。

## 故障处理

1. 运行 `kos-harness validate --format json`。
2. 按 finding 中的 validator、path 和 message 定位文件。
3. 修复单个对象或 Skill，不批量重写整个 Vault。
4. 重新运行对应 Task/Skill Eval。
5. 确定性检查通过后，再由用户审阅语义质量。

框架开发、发布检查和 release eval 位于 kos-framework 的 `dev/`，不属于用户 runtime。
