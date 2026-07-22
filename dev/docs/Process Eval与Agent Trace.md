# Process Eval 与 Agent Trace

## 1. 目标与边界

Process Eval 回答两个与最终产物不同的问题：

1. Agent 是否在正例中加载目标 Skill，并在负例中避免误加载。
2. Agent 是否按照 Skill 协议执行了必需步骤，且没有发生禁止行为。

它属于 `kos-framework/dev/` 的开发验证层。Runtime Distribution 仍保持后端无关，不包含 Pi runner、模型认证或开发评估合同。

```text
checked-in prompt
-> Process Eval contract
-> disposable kos-test fixture
-> Pi --mode json
-> normalized trace
-> deterministic protocol evaluator
-> ignored JSON artifact
```

## 2. 目录

```text
dev/evals/core/*.prompts.csv        # prompt 与目标 Skill
dev/evals/process/*.process.yaml    # L1 过程合同
dev/evals/schemas/                  # 合同、trace、结果 schema
dev/evals/artifacts/                # 运行产物，JSON 被 gitignore
dev/harness/run_process_evals.py    # Pi runner
dev/harness/process_eval_common.py  # trace 归一化与判分
dev/harness/validate_process_evals.py
```

## 3. Process Eval 合同

过程合同引用 core prompt CSV 中的稳定 case，不复制 prompt：

```yaml
version: 1
id: kos-system-check-full
prompt_file: kos-system-check.prompts.csv
prompt_case_id: full-system-01
backend: pi
timeout_seconds: 240
thinking_level: low
tools: [read, bash, grep, find, ls]
protocol:
  required_skill_reads: [kos-system-check]
  required_reads:
    - .kos.md
    - 90_系统/规则/对象规范.md
  required_tools: [read, bash]
  required_commands:
    - validate_paths.py
    - validate_schema.py
  forbidden_tools: [write, edit]
  forbidden_commands: []
  forbidden_path_fragments: []
  forbid_vault_changes: true
```

正例必须把 prompt CSV 声明的目标 Skill 放入 `required_skill_reads`。负例不得这样做；路由判分会自动检查目标 Skill 没有被加载。

## 4. 标准化 Trace

Pi 原始 JSON 流包含增量 thinking、签名、token 使用量、工具调用和消息。Process Eval 只保留判断协议所需的最小事件：

```json
{
  "type": "tool_call",
  "tool": "bash",
  "args": {
    "command": "python3 90_系统/harness/validate_paths.py"
  }
}
```

归一化过程会：

- 丢弃 thinking、encrypted content、token 明细和工具输出正文。
- 把测试 Vault 内的绝对路径改成相对路径。
- 对 home 路径去标识化。
- 保留 backend、provider、model、API、退出码、工具名、参数和错误状态。
- 保存最终文本用于人工复核，但不依赖最终文本判定步骤是否执行。

最终回答或 Agent 自评不能替代 trace。只有实际 `tool_call` 事件才能证明读取了 Skill 或调用了 Harness。

## 5. 指标

每个 case 输出：

- `route_pass`：正例加载目标 Skill，或负例没有加载目标 Skill。
- `protocol_pass`：必需步骤全部完成，禁止检查全部通过。
- `required_step_coverage`：通过的必需步骤数 / 必需步骤总数。
- `forbidden_violation_count`：禁止工具、命令、路径、工具错误和非预期 Vault 改动数量。

整轮输出：

- route precision / recall；
- 通过 case 数；
- 聚合 required step coverage；
- forbidden violation count。

`overall_pass` 要求路由和协议同时通过。任务结果正确但加载了错误 Skill，仍是 Process Eval 失败。

## 6. Fixture 与安全

每个 case 都从当前 `vault/` 构建独立的临时 `kos-test`，case 结束后销毁。runner：

- 只加载 `80_Skills/core`，不加载个人全局 Skills；
- 固定 tools、thinking level、timeout；
- 关闭 Pi telemetry 和版本检查；
- 默认检查 Vault 内容哈希，报告非预期增删改；
- 忽略 `.pi/`、测试标记、framework manifest、缓存、reports 和 artifacts 等生成内容；
- 不读取或同步真实用户 `kos`。

允许 `bash` 的合同仍必须只选择无外部副作用的 prompt，并用 required/forbidden command 约束。发送、付款、发布、删除等不可逆任务不得作为自动 Process Eval。

## 7. 运行

只验证合同和 schema，不调用模型：

```bash
make process-eval-validate
```

运行全部 Pi Process Eval 并写 artifact：

```bash
make process-eval
```

运行单个 suite 或 case：

```bash
python3 dev/harness/run_process_evals.py --suite kos-system-check
python3 dev/harness/run_process_evals.py --case full-system-01
```

实时调用不属于 `release-check`，因为 CI 不应依赖个人模型账号和网络。`release-check` 会验证合同、schema、归一化器、判分器和测试。

## 8. 扩展其他后端

判分器读取的是统一 trace，不应直接依赖 Pi JSON。增加 Codex、Claude Code 或 Hermes 时，只新增 backend runner/adapter，将其事件转成相同的 `tool_call` / `tool_result`，过程合同和指标保持不变。
