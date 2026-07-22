# Pi 驱动 kos-test

## 1. 三层边界

kos 开发和使用分为三个独立层：

| 层 | 职责 | 内容性质 |
|---|---|---|
| `kos-framework` | 开发通用框架、Runtime Distribution、Harness 和 Eval | 不含用户定制 |
| `kos-test` | 从当前 framework 构建的测试 Vault，由开发 Agent 执行运行时任务 | 可丢弃，不得同步到用户 Vault |
| `kos` | 用户长期使用的真实 Vault | 包含个人内容、配置和集成 |

Pi 在这里属于 Framework Development 的测试执行器。Pi 本身和它的私有认证配置不是 runtime 依赖，不进入 `vault/`。

## 2. 构建与启动

默认测试 Vault 位于 framework 仓库的同级目录 `../kos-test`：

```bash
make kos-test-build
make kos-test
```

`make kos-test-build` 创建或刷新测试 Vault。刷新只同步 framework 管理的路径，保留测试过程中生成的笔记和对象。

`make kos-test` 先刷新，再从测试 Vault 根目录启动 Pi。启动器会关闭默认 Skill discovery，只显式加载 `80_Skills/core/`，避免个人全局 Skills 污染 framework 测试；同时追加 kos-test 专用运行边界，并沿用 Pi 的全局模型与认证配置。

需要清空全部测试产物时使用：

```bash
make kos-test-reset
```

重建操作只接受带 `.kos-test.json` 标记、且属于当前 framework checkout 的目录。未标记目录会被拒绝，避免误删真实 `kos`。

可临时指定其他测试路径或 Pi 命令：

```bash
make kos-test KOS_TEST_VAULT=/tmp/my-kos-test
make kos-test PI=/custom/path/to/pi
```

## 3. 注入到测试 Vault 的开发配置

构建工具会在 `kos-test` 中生成以下开发专用文件：

```text
.kos-test.json          # 测试层身份和来源标记
.pi/settings.json       # 让 Pi 加载 80_Skills/core
.pi/APPEND_SYSTEM.md    # 限制 Pi 只操作当前测试 Vault
```

这些文件不属于 `vault/` 分发内容，也不会由 framework 同步到用户 `kos`。

## 4. 验证责任

Pi 可以执行真实 kos 任务并暴露 Skill、提示和工作流问题，但不是信任根：

1. Pi 在 `kos-test` 中执行任务并留下可复现证据。
2. framework 修改回到 `kos-framework` 的正确层完成。
3. 对应 Runtime 或 Development Eval 必须覆盖该问题。
4. 最终仍需通过 `make release-check`。

交互式开发测试使用 `make kos-test`。自动 Process Eval 使用 `make process-eval`：它在独立临时 `kos-test` 中运行 checked-in prompt，记录去敏后的标准化 trace，并保存 backend、model、thinking、framework 和 Skill 版本指纹。详细设计见 `dev/docs/Process Eval与Agent Trace.md`。
