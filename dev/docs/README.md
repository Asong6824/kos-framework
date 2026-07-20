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
- `原公开仓库文档归档.md`：原 `docs/` 目录内容的本地归档。
