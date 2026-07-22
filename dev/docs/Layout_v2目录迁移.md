# Layout v2 目录迁移

## 决策

Layout v2 按用户工作流重新分层：输入与雷达位于 `10–12`，处理、研究、知识和方法位于 `20–23`，半年目标、项目和任务位于 `30–32`，日记、认知记录和个人操作画像位于 `40–42`，Skills 位于 `80`，系统内容保留在 `90`。

目录映射：

```text
50_信息雷达       -> 12_信息雷达
40_方法库         -> 23_方法库
26_目标           -> 30_目标
30_项目           -> 31_项目
31_任务           -> 32_任务
23_日记           -> 40_日记
24_认知记录       -> 41_认知记录
25_个人操作画像   -> 42_个人操作画像
41_Skills         -> 80_Skills
```

## 跨层契约

- Vault 的 `90_系统/framework.yaml` 使用 `layout_version: 2` 标识完成迁移。
- kos-agent 的 `migrate-layout` 负责备份、暂存搬移、文本引用重写、失败回滚和幂等判断。
- Framework 同步拒绝 layout_version 缺失或小于 2 的 Vault，防止同步产生新旧双目录。
- kos Companion 的 data.json v7 只迁移仍等于 Layout v1 标准值的 `objectDirs` 字段，保留用户自定义目录。

## 验收

迁移必须覆盖 dry-run、编号互换目录、目标目录冲突、引用重写、备份、layout_version 写入和二次执行幂等。下游同步前运行 `make release-check`；真实 Vault 先在副本完成迁移、同步和 Harness 验证，再执行实际迁移与 Obsidian E2E。
