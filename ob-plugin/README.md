# kos-obsidian-plugin

kos 的 Obsidian 插件项目（插件 id：`kos-companion`）。为 kos vault 提供实时、原生、可视化的交互层。

本目录独立于 kos-framework 的 `vault/`（运行时）和 `dev/`（框架开发）：

- 插件源码、文档、测试都放在这里，不进入 framework 的分发链路。
- 插件以 kos 对象规范为只读契约，遵守 `vault/90_系统/规则/对象规范.md` 的路径、状态机与权限表。

## 文档

- [docs/01_功能规格.md](docs/01_功能规格.md) — 功能清单与 MVP 优先级（What）
- [docs/02_技术方案.md](docs/02_技术方案.md) — 架构、数据模型、存储与测试策略（How）
- [docs/03_指标定义.md](docs/03_指标定义.md) — 全部量化指标的公式与边界口径（唯一标准）

## 开发指南

```bash
cd ob-plugin
npm install          # 安装依赖
npm run dev          # esbuild watch 模式，改代码即重打包
npm run build        # 生产构建 main.js
npm run typecheck    # tsc --noEmit
npm test             # Vitest，只测 src/core/
```

本地调试循环：

1. 生成测试 vault：`python3 ../dev/harness/init_vault.py /tmp/kos-test`
2. 把本目录软链进测试 vault：`ln -s "$PWD" /tmp/kos-test/.obsidian/plugins/kos-companion`
3. `npm run dev`，用 Obsidian 打开 /tmp/kos-test，设置里启用 "kos Companion"
4. 建议装社区插件 Hot Reload 实现改码自动重载；`Cmd+Opt+I` 打开 DevTools 调试
5. 用 `90_系统/harness/create_*.py` 在测试 vault 里批量造各状态的对象

### 个性化目录布局

索引是 **type-first**：归类只看 frontmatter 的 `type` 字段，与文件放在哪个目录无关（唯一例外：`90_系统/` 整体排除，因为模板带合法 `type`；收件箱目录单独统计）。因此个性化目录布局下全部指标开箱即用，唯一需要配置的是"路径依赖型行为"——快速捕获/创建向导/日记的落盘目录与收件箱位置。

在设置页"目录映射（个性化布局）"分区逐项填写 vault 相对目录（不带首尾斜杠），留空回落标准默认值。示例——某用户的个性化布局及对应填法：

| 设置项 | 该用户的目录 | 标准默认 |
|--------|--------------|----------|
| 收件箱（inbox） | `10_输入/11_收件箱` | `10_收件箱` |
| 原材料（source） | `10_输入/12_原材料`（format 中文子目录如 `书籍/文章` 照常在下面拼） | `11_原材料` |
| 信息雷达（radar） | `10_输入/13_信息雷达` | `50_信息雷达` |
| 摘录（extract） | `20_处理/21_摘录` | `20_处理区/摘录` |
| 摘要（summary） | `20_处理/22_摘要` | `20_处理区/摘要` |
| 研究（research） | `20_处理/23_研究` | `21_研究` |
| 知识库（concept） | `30_知识/31_知识库` | `22_知识库` |
| 方法库（method） | `30_知识/32_方法库` | `40_方法库` |
| 项目（project） | `40_行动/41_项目` | `30_项目` |
| 任务（task） | `40_行动/42_任务` | `31_任务` |
| 日记（diary） | `50_复盘/51_日记`（YYYY/MM 嵌套照常拼） | `23_日记` |
| 认知记录（reflection） | `50_复盘/52_认知记录` | `24_认知记录` |

`90_系统/模板`、`00_工作台` 与标准一致时无需任何配置。

## 结构

```text
src/core/       # 纯 TS，零 obsidian 依赖：对象模型、状态机、M1–M14 指标、快照（Vitest 覆盖）
src/data/       # KosIndex（metadataCache 增量索引）+ KosDataStore（data.json 持久化）
src/views/      # 驾驶舱 / 热力图 / 待审核中心 / 聚合任务 四个 ItemView + 自绘 SVG 组件
src/actions/    # 快速捕获、创建向导、状态流转、审核通过、徽章、周月报
src/bridge/     # Python harness 桥接（仅桌面端，运行时探测）
tests/          # Vitest，镜像 src/core
```

约定：指标口径以 `docs/03_指标定义.md` 为唯一标准，`src/core/metrics.ts` 函数与指标编号一一对应；状态机与权限表编码在 `src/core/model.ts`，上游契约变更时同步改这两处。
