# kos 开发文档

本目录用于保存 kos-framework 的内部设计推导、文档写作总纲、取舍记录和发布前草稿。

本目录属于 `dev/` 开发层，可以进入源码仓库，但不会随 runtime vault 分发。写入本目录前必须去除个人路径、账号、凭据、私有 vault 内容和未去敏调试记录。

当前文档只有两层：

```text
dev/docs/            # framework 开发文档，不随 runtime vault 分发
vault/90_系统/文档/  # 跟随 runtime vault 发布的用户文档
```

工作方式：

```text
本地设计推导
-> 内部评审
-> 去掉个人信息和过程噪声
-> 提炼成用户文档
-> 用实际操作验证文档
```

## 文档索引

- `文档编写总纲.md`：runtime 用户文档和开发文档的写作原则。
- `Skill机制设计.md`：Skill 驱动、scope、Harness、Eval、生命周期和人工治理的完整设计推导。
- `Skill评估两层模型.md`：Contract Gate、Process Eval 和 Task Completion 的分层设计。
- `Process Eval与Agent Trace.md`：Pi trace 采集、过程合同、指标和安全边界。
- `Pi驱动kos-test.md`：三层 Vault 边界和 Pi 测试入口。
- `自举与维护边界.md`：Runtime Distribution 和 Framework Development 的信任与依赖边界。
- `Obsidian看板二期优化.md`：看板作为 kos-agent 工作流触发器和结果载体的二期设计。
- `个性化协作与每日推荐优化.md`：测评输入、个人操作画像、Agent Context 和每日个性化推荐的现状基线与关键断层。
- `目标驱动的个人推进体系设计.md`：年度/月度目标、Project、Task、个人画像、Agent 规划与复盘闭环的完整设计提案。
- `H1H2目标驱动推进体系操作需求.md`：H1/H2 Goal、Project、公共 Task Pool 在 Vault、kos-agent/Harness 和 Obsidian 看板中的操作合同与验收需求；该功能与旧目标设计冲突时以本文为准。
- `LiveSync与R2设备同步方案.md`：桌面 Agent、移动 Obsidian 和低成本 R2 设备同步的选型、数据边界、实现阶段和发布验收。
- `Layout_v2目录迁移.md`：目录重排映射、跨层版本契约、迁移职责和发布验收。
- `原公开仓库文档归档.md`：原 `docs/` 目录内容的本地归档。
