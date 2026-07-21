# Obsidian 看板二期优化

> 状态：设计草案，随讨论持续更新
> 范围：kos Companion 中央看板与 kos-agent 的协作方式

## 1. 背景

当前看板主要从 Vault 索引中读取确定性数据，展示知识资产、今日进度、输入管道、成熟度、任务、待审阅项和活动趋势。Agent 则主要存在于独立的右侧对话视图中。

这种分工完成了“数据看板 + Agent 对话”的基础闭环，但两者仍偏并列：看板主要负责展示，用户需要主动切换到 Agent 并重新表达意图，Agent 的执行过程和结果也主要停留在对话视图中。

二期需要把看板进一步纳入 kos-agent Harness，使它不只是数据展示页，也是 Agent 工作流的触发器和结果载体。

## 2. 核心原则：看板既是触发器，也是结果载体

```text
看板状态或用户动作
-> 触发 kos-agent 工作流
-> Agent 基于确定性上下文判断和执行
-> 看板承载执行进度、待回答问题和最终结果
-> Vault 变化驱动看板再次刷新
```

这里的“触发器”不只是一个打开聊天窗口的按钮。看板可以根据明确的产品事件，直接创建或恢复 Agent session，并向 kos-agent 发起具有完整上下文的任务。

这里的“结果载体”也不只是展示 Agent 的最后一段文本。看板应能展示：

- Agent 当前是否正在执行。
- 本次工作流使用了哪些对象和上下文。
- Agent 给出的结构化建议和下一步行动。
- 等待用户回答的 `ask_question`。
- Agent 创建或修改的项目、任务、工作台和其他对象。
- Validator、Task Completion 和失败信息。

Agent 对话侧栏继续保留，负责完整会话、工具调用、diff 和 session 管理；中央看板负责把与当前业务场景有关的过程和结果呈现在原来的工作位置。两者使用同一个 session 和运行状态，不维护两份互相独立的 Agent 任务。

## 3. 首个场景：每天第一次打开看板

每天第一次打开“今日”看板时，插件默认自动触发一次开始新一天的 Agent 工作流，不要求用户批准。

推荐流程：

```text
打开今日看板
-> 系统判断今天是否已经运行 start-my-day
-> 汇总今天的确定性上下文
-> 创建或恢复当天的 Agent session
-> 向 kos-agent 发起“开始今天的工作”任务
-> Agent 激活 kos-start-my-day Skill
-> Agent 更新今日工作台并给出今日主线
-> 看板展示结果或挂起的 ask_question
```

提供给 Agent 的上下文至少包括：

- 当前日期。
- active、blocked、paused 和停滞项目。
- todo、doing、blocked 和到期任务。
- 输入积压与待审阅对象。
- 昨日日记、昨日未完成事项和最近项目进展。
- 当前有效的个人操作画像。
- Validator 异常和今天已经发生的活动。

Agent 负责在这些事实之上：

- 判断今天最值得推进的主线。
- 给出排序理由、依赖和风险。
- 更新 `00_工作台/今日工作台.md`。
- 在信息不足或需要用户取舍时调用 `ask_question`。
- 根据用户后续回答继续创建任务、更新项目或调整今日安排。

## 4. 系统、模型和界面的职责

### 系统负责

- 判断是否为当天首次触发。
- 从 Vault 索引和 kos Harness 取得确定性事实。
- 创建、恢复和持久化当天的 Agent session。
- 保证同一天重复打开看板不会重复启动工作流。
- 记录运行状态、失败原因和最后更新时间。
- 在 Agent 不可用时继续提供只依赖索引的看板。

任务数、待审阅数、状态分布、停滞天数等事实不能交给模型自行计算。

### Agent 负责

- 理解当前上下文。
- 判断优先级和下一步行动。
- 组织跨对象、多步骤工作流。
- 更新 Vault 中需要长期保存的产物。
- 在需要用户判断时提出问题，并在回答后继续执行。

### 看板负责

- 触发工作流并展示当前运行状态。
- 将确定性事实与 Agent 建议明确区分。
- 把 Agent 结果转换成可操作的任务、项目和审阅入口。
- 让用户从结果跳转到完整对话、相关对象和 diff。
- 在 Vault 发生变化后实时刷新。

## 5. 每日运行状态与幂等性

看板渲染不能直接等价于模型调用。每日工作流需要持久化独立状态：

```text
not_started
-> running
-> waiting_for_user
-> completed

running / waiting_for_user
-> failed
-> running
```

同一天重复打开或刷新看板时：

- `running`：恢复并展示现有执行过程。
- `waiting_for_user`：继续展示尚未回答的问题。
- `completed`：展示已有结果，不再次调用模型。
- `failed`：保留确定性看板，并提供重试入口。

用户可以显式执行“重新规划今天”，它在同一天创建新的运行或会话分支，但不能由普通视图刷新隐式触发。

每日运行记录至少需要关联 `date`、`sessionId`、`status`、`startedAt`、`updatedAt` 和结果摘要。具体由插件数据还是 kos-agent session metadata 保存，实施前再确定唯一真相源。

## 6. “今日”看板需要承载的 Agent 结果

今日页面的首屏应优先展示行动结果，而不是长期统计：

- 今日主线及其排序理由。
- Agent 当前执行状态。
- 待用户回答的问题。
- 建议推进的项目和任务。
- 今日输入与审阅建议。
- Agent 本次创建或更新的对象。
- Validator 或 Task Completion 反馈。
- 上次运行时间、继续对话和重新规划入口。

知识复利、成熟度、热力图和心情趋势等长期指标仍由系统确定性计算，但不应遮挡每日工作流的主要结果。

## 7. 失败与降级

- 模型未配置、网络失败或 kos-agent host 不可用时，看板仍展示确定性数据。
- 已完成的部分操作和 Vault 变更不能因会话失败而隐藏。
- 失败状态必须包含可重试入口，并允许跳转到 Agent 对话查看错误。
- `ask_question` 必须能够跨视图关闭和 Obsidian 重启恢复。
- 看板不能根据一段未落盘的自然语言回答推断任务已经完成；完成状态以 Vault 结果和 Harness 反馈为准。

## 8. 资料与阅读：看板内置 Reader

### 8.1 产品定位变化

如果看板成为 kos 功能的主要载体，“资料与阅读”应成为一级模块，阅读器则是该模块打开 Source 后进入的中央工作区。它不是仪表卡片，也不是独立于 kos 对象的通用阅读软件。

当前 runtime 文档仍把 kos 定位为“阅读后的知识处理层，不替代阅读软件”。二期采用内置 Reader 后，需要同步修改这一边界：阅读、划线、批注、摘要、审阅和后续知识沉淀都可以在 kos 内完成，但 kos 不负责电子书商店、版权内容分发、DRM 破解或全功能文献管理。

Reader 与 Agent 的关系继续遵守“看板既是触发器，也是结果载体”：

```text
打开 Source
-> Reader 恢复阅读位置
-> 用户划线或批注
-> Harness 确定性写入 Extract
-> 章节完成或阅读会话结束
-> 看板触发 kos-agent 总结
-> Agent 更新 Summary 并提出后续问题
-> 看板展示本次阅读成果和关联对象
```

### 8.2 原文、划线和摘要必须分层

划线不能直接作为 AI Summary 写入摘要目录。阅读工作流必须保持以下语义：

```text
PDF / EPUB 原文件 -> Source
原文划线与忠实摘录 -> Extract
AI 归纳与结构化理解 -> Summary
用户判断变化 -> Reflection
长期沉淀 -> Research / Concept / Method
```

推荐的 MVP 存储粒度：

- 每个 Source 对应一个持续追加的 Extract 文件。
- 每个 Source 对应一个持续更新的 Summary 文件。
- 每条划线拥有稳定 `annotationId` 和 Markdown block ID。
- Summary 引用具体划线 block ID，保留原文证据链。
- Source 的 `extract_file` 和 `summary_file` 继续指向上述两个聚合文件。

### 8.3 PDF 与 EPUB 使用统一 Reader 接口

Reader 从第一版开始按多格式适配层设计，不能分别建立两套阅读业务逻辑：

```text
Reader View
├── PDF Adapter
├── EPUB Adapter
└── Annotation / Progress / Agent Context
```

所有格式适配器至少提供：

- 打开、关闭和渲染文档。
- 目录、搜索和位置跳转。
- 获取选区文本和前后文。
- 创建、解析、恢复和删除锚点。
- 读取和恢复阅读进度。
- 提取当前页、当前章节或指定范围的 Agent 上下文。

格式差异封装在 Adapter 内：

| 能力 | PDF | EPUB |
|---|---|---|
| 稳定定位 | 页码、文字层坐标区域、文本引用 | EPUB CFI、spine/chapter、文本引用 |
| 阅读进度 | 当前页 / 总页数 | CFI / progression |
| Agent 上下文 | 当前页、连续页、选区 | 当前章节、连续章节、选区 |
| 划线回显 | 页面 highlight overlay | CFI range 恢复 |
| 主要限制 | 扫描件、双栏、断词、加密 | 重排、章节拆分、样式隔离、DRM |

不能只保存屏幕坐标。EPUB 会随窗口、字号和主题重排，必须使用 CFI；PDF 必须保存页码和文字层区域。两种格式都应额外保存所选文本、前后文和原文件 hash，用于文件变化后的锚点校验与恢复。

统一锚点模型建议使用判别联合：

```ts
type ReaderAnchor =
  | {
      format: "pdf";
      page: number;
      rects: Rect[];
      text: string;
      prefix?: string;
      suffix?: string;
    }
  | {
      format: "epub";
      cfiRange: string;
      chapterHref: string;
      chapterTitle?: string;
      text: string;
      prefix?: string;
      suffix?: string;
    };
```

### 8.4 Annotation 的持久化

人可读信息写入 Extract，渲染器所需的技术锚点写在同一 Markdown 块的隐藏结构化元数据中。例如：

```markdown
> 系统会塑造使用它的人的思维方式。 ^hl-a82f

- 位置：第 42 页
- 批注：联系到当前知识工具项目。
<!-- kos-reader: {"annotationId":"hl-a82f","format":"pdf","page":42} -->
```

完整实现还需保存 `rects` 或 `cfiRange`、source、原文件 hash、颜色、创建时间和更新时间。不能只把锚点放进 Obsidian 插件 `data.json`，否则插件数据丢失或未同步时，Extract 虽然存在，却无法跳回原文。

高频划线写入不调用模型。它应由共享的确定性 Reader 存储能力完成，并保证原子写入、去重、更新 Source 引用和校验。桌面端可以通过 kos-agent RPC 调用该能力；如果 Reader 需要支持移动端，应把同一份纯 TypeScript 存储核心同时编译进插件，而不是重新实现第二套规则。

### 8.5 Reader 触发 Agent 的时机

Reader 可以向看板发出统一事件：

```text
reader.opened
annotation.created
progress.updated
chapter.completed
reading_session.completed
```

单次划线只做确定性落盘，不应自动调用一次模型。适合触发 Agent 的场景包括：

- 用户主动要求解释、比较或联系当前项目。
- 完成一个章节。
- 阅读会话结束且产生了新划线或批注。
- 累积了足够多的未处理划线。
- 完成整本书，需要生成最终摘要或读后复盘。

Agent 每次只接收任务所需的选区、章节或新增划线集合，不默认把整本 PDF/EPUB 上传给模型。自动摘要以 `annotationId` 和阅读 session 为幂等边界，不能重复消费同一批划线。

### 8.6 复用优先，不从头实现阅读内核

Reader 的实现遵守 kos-agent 已确定的复用原则：缺失能力先查成熟开源库、Obsidian 官方能力和社区插件，再决定是否自行实现。kos 主要实现的是对象映射、Annotation 持久化、Agent 上下文和工作流编排，不自行开发 PDF 或 EPUB 排版引擎。

实施前按以下顺序调研：

1. Obsidian 是否已经提供稳定的内置视图或公开 API。
2. 现有社区插件是否暴露可复用 API 或可移植模块。
3. 成熟底层开源库是否可以直接集成。
4. 只有上述方案不能满足功能、许可证、安全、移动端或维护要求时，才实现 kos 专属适配代码。

初步候选，不代表已经完成技术选型：

| 方向 | 候选 | 初步用途 | 初步许可证判断 |
|---|---|---|---|
| PDF 底层 | [PDF.js](https://github.com/mozilla/pdf.js) | 渲染、文字层、页面与选区 | Apache-2.0 |
| PDF Obsidian 体验 | [PDF++](https://github.com/RyotaUshio/obsidian-pdf-plus) | 批注交互、Obsidian 集成和链接设计 | MIT |
| EPUB 底层 | [epub.js](https://github.com/futurepress/epub.js) | EPUB 渲染、目录、CFI 和选区 | BSD 风格许可，接入前再次核对发布版本 |
| EPUB Obsidian 体验 | [obsidian-epub-plugin](https://github.com/caronchen/obsidian-epub-plugin) | EPUB View、文件打开和 Obsidian 生命周期 | MIT |
| PDF/EPUB 综合参考 | [Amnesia](https://github.com/jjjjguevara/amnesia) | 双格式 Reader 架构和插件 API | AGPL-3.0，只能在许可证评估后决定是否复用代码 |

选型时必须检查：

- 许可证能否与 kos-framework 的发布方式兼容。
- 项目是否仍在维护，关键问题是否有响应。
- 是否依赖 Obsidian 未公开、易变化的内部 API。
- 桌面端和移动端支持范围。
- 是否能导出稳定锚点和原始选区文本。
- bundle 体积、内存、超大文件和安全边界。
- 上游 revision、修改范围和 `THIRD_PARTY_NOTICES` 是否可追踪。

默认不要求用户同时安装另一个社区插件。若对方没有稳定公共 API，优先在许可证允许的前提下选择性移植必要模块并保留归属与上游 revision，而不是把 kos 的核心工作流绑定到另一插件的私有内部状态。

### 8.7 Reader MVP 边界

第一版支持：

- 有文字层的本地 PDF。
- 无 DRM 的 EPUB。
- 目录、搜索、阅读进度恢复。
- 划线、批注、删除和跳回原文。
- 自动写入 Extract。
- 按章节或阅读 session 生成 Summary。
- 对选区调用 Agent，并关联 Project、Research、Concept 或 Method。

第一版不支持：

- 扫描 PDF OCR。
- 加密 PDF 和 DRM EPUB。
- PDF 手写批注。
- 自建电子书商店或版权内容分发。
- 默认把整本书发送给模型。

## 9. 后续讨论

后续在本文继续补充：

- 看板一级模块和导航结构。
- 其他适合由看板触发的 Agent 工作流。
- 各模块的直接 UI 操作与 Agent 操作边界。
- Agent 结果在看板中的统一组件规范。
- 每日 session 与普通对话 session 的生命周期关系。
- Reader 原文件的 Vault 目录、外部路径与同步策略。
- 阅读 session、章节摘要和全书摘要之间的生命周期。
- 对应的事件协议、持久化结构和 Eval。
