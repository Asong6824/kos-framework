# kos-obsidian-plugin

kos 的 Obsidian 插件项目（插件 id：`kos-companion`）。为 kos vault 提供实时、原生、可视化的交互层。

二期中央工作台采用 Nothing-inspired 设计系统，把四张工具卡与“今日、行动、输入、知识、审阅与复盘、系统”六个业务区块放在同一个响应式 Bento 页面中，不需要切换模块。桌面使用 12 列整数格，进入“编辑布局”后十张卡均可自由拖动、整格缩放、碰撞避让、撤销、重做和恢复默认；布局写入插件私有数据，内容过多时仍自动整格撑开且不产生卡片内滚动。移动端保持单列连续页面。Agent 保持为右侧栏，Reader 保持为独立 Obsidian 视图。

Agent 侧栏支持 Vault `@mention`、Skill/prompt 菜单、运行中 steering/follow-up、thinking/usage、`ask_question`，以及当前模型或 Brave/Exa 驱动的 Web 搜索。

视图层采用渐进式 React 策略：看板由 React 18 管理统一 Bento 布局外壳、dnd-kit 拖动和 Framer Motion 避让动画，六个业务区块内部继续复用 Obsidian 原生 DOM 动作；点阵时钟、当日任务时刻、实时年度进度和 M5 热点图同样位于该网格，并可从四边或四角整格缩放。任务通过可选 `scheduled_times: ["HH:mm"]` 进入当日 48 点时间轴；热点图只使用真实 M5 数据。Reader 在独立 `ItemView` 内挂载 React UI，支持 Source Markdown、本地 PDF 和无 DRM EPUB、目录/翻页及阅读位置恢复。PDF 默认纵向连续滚动，并只为当前页附近渲染 Canvas/文字层；EPUB 默认跨章节连续滚动，也可从工具栏切换为分页阅读，切换时沿用当前 CFI。插件注册 `.epub` 扩展，因此 EPUB 会显示在 Obsidian 文件树并可直接点击；没有关联 Source 时按书籍模板自动创建。PDF 保留 Obsidian 原生默认视图，可通过文件右键菜单或“使用 kos Reader 打开当前文件”命令进入 Reader。用户选中文本后可以确定性写入关联 Extract，也可以把带 Source、原文件和位置的引用预填到 Agent 输入框；后者不会自动发送消息。PDF 使用 Obsidian 公开 `loadPdfJs()`，EPUB 固定使用 `epubjs@0.3.93`；Reader 进度和十张卡的统一布局只写插件私有 `data.json`，实时指标值不持久化。搜索、持久划线回显、批注和章节/阅读会话 Summary 尚未实现。

EPUB 显示与默认打开由插件加载时的 `registerExtensions(['epub'], 'kos-reader')` 完成，不修改 Obsidian 应用文件。禁用或卸载插件后注册自动消失；若其他插件也注册 `.epub`，处理器选择可能受插件加载顺序影响。React、ReactDOM、dnd-kit、Framer Motion 和 epub.js 都打包进发布版 `main.js`，使用者无需执行 `npm install`。安装或覆盖发布目录后必须重新加载 kos Companion 或重启 Obsidian，正在运行的旧插件实例不会自动采用新的 bundle。

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
npm run test:e2e     # 独立临时 Vault + 真实 Obsidian + kos-agent RPC
```

本地调试循环：

1. 生成测试 vault：`python3 ../dev/harness/init_vault.py /tmp/kos-test`
2. 把本目录软链进测试 vault：`ln -s "$PWD" /tmp/kos-test/.obsidian/plugins/kos-companion`
3. `npm run dev`，用 Obsidian 打开 /tmp/kos-test，设置里启用 "kos Companion"
4. 建议装社区插件 Hot Reload 实现改码自动重载；`Cmd+Opt+I` 打开 DevTools 调试
5. 用 `kos-harness create` 在测试 vault 里批量造各状态的对象

正式本地发布先在仓库根目录运行 `make release-check`，产物位于 `release/kos-companion/`。同步到现有 Vault 时保留目标插件目录中的 `data.json`，因为其中包含用户设置、历史快照、徽章、Reader 进度和自定义看板布局。

`npm run test:e2e` 需要 macOS 上已安装 `/Applications/Obsidian.app`，以及 Node.js 22.19+。脚本会创建独立的临时 Vault 和 `user-data-dir`，不会打开、修改或关闭用户当前 Vault；它通过 Obsidian 的 Chrome DevTools Protocol 验证 Bento 编辑格线、真实拖动与缩放、碰撞无重叠、撤销/重做/复位和布局落盘，同时覆盖区块无内部滚动、桌面/390px 布局、Reader、PDF/EPUB、Extract、Agent 草稿和确定性任务流转。截图和夹具路径会输出到终端。

### 个性化目录布局

索引是 **type-first**：归类只看 frontmatter 的 `type` 字段，与文件放在哪个目录无关（唯一例外：`90_系统/` 整体排除，因为模板带合法 `type`；收件箱目录单独统计）。因此个性化目录布局下全部指标开箱即用，唯一需要配置的是"路径依赖型行为"——快速捕获/创建向导/日记的落盘目录与收件箱位置。

在设置页"目录映射（个性化布局）"分区逐项填写 vault 相对目录（不带首尾斜杠），留空回落标准默认值。示例——某用户的个性化布局及对应填法：

| 设置项 | 该用户的目录 | 标准默认 |
|--------|--------------|----------|
| 收件箱（inbox） | `10_输入/11_收件箱` | `10_收件箱` |
| 原材料（source） | `10_输入/12_原材料`（format 中文子目录如 `书籍/文章` 照常在下面拼） | `11_原材料` |
| 信息雷达（radar） | `10_输入/13_信息雷达` | `12_信息雷达` |
| 摘录（extract） | `20_处理/21_摘录` | `20_处理区/摘录` |
| 摘要（summary） | `20_处理/22_摘要` | `20_处理区/摘要` |
| 研究（research） | `20_处理/23_研究` | `21_研究` |
| 知识库（concept） | `30_知识/31_知识库` | `22_知识库` |
| 方法库（method） | `30_知识/32_方法库` | `23_方法库` |
| 项目（project） | `40_行动/41_项目` | `31_项目` |
| 任务（task） | `40_行动/42_任务` | `32_任务` |
| 日记（diary） | `50_复盘/51_日记`（YYYY/MM 嵌套照常拼） | `40_日记` |
| 认知记录（reflection） | `50_复盘/52_认知记录` | `41_认知记录` |

`90_系统/模板`、`00_工作台` 与标准一致时无需任何配置。

## 结构

```text
src/core/       # 纯 TS，零 obsidian 依赖：对象模型、状态机、M1–M14 指标、二期看板模型（Vitest 覆盖）
src/data/       # KosIndex（metadataCache 增量索引）+ KosDataStore（data.json 持久化）
src/views/      # 六区块响应式 Bento 工作台、独立 Reader、Agent 侧栏；复杂视图渐进挂载 React Root
src/actions/    # 快速捕获、创建向导、状态流转、审核通过、徽章、周月报
src/bridge/     # kos-agent host 启动与结构化验证展示
tests/          # Vitest：core、Agent contract、Reader 纯逻辑与进度迁移
e2e/            # 真实 Obsidian + kos-agent 的无额外依赖 CDP 验收
```

约定：指标口径以 `docs/03_指标定义.md` 为唯一标准，`src/core/metrics.ts` 函数与指标编号一一对应；状态机与权限表编码在 `src/core/model.ts`，上游契约变更时同步改这两处。
