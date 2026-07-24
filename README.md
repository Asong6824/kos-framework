# kos

kos 是一个运行在 Obsidian 中、以开放 Markdown 为数据层的个人知识与行动 Agent。

它把输入、阅读、研究、知识、目标、项目、任务和复盘连接成一组可验证、可恢复的工作流。用户拥有全部 Markdown 数据；kos-agent 负责理解目标、调用工具和持续执行；确定性 Harness 负责对象状态、原子写入、校验、Eval 和失败反馈；kos Companion 提供驾驶舱、Agent 侧栏与独立 Reader。

> 当前版本：kos Companion `0.2.0`。桌面 Agent 需要 Node.js 22.19+；不调用模型时，驾驶舱和 Reader 仍可独立使用。

![真实 kos 驾驶舱与 Agent](vault/90_系统/文档/assets/readme/kos-dashboard-agent-real.png)

上图来自作者持续使用的真实 Vault，而不是静态设计稿。它同时展示了真实 Project、任务状态、Agent 执行记录和系统中尚待治理的问题。

## kos 解决什么问题

普通笔记工具擅长保存信息，但很难长期回答下面这些问题：

- 当前目标真正要求我推进什么？
- 收集的材料是否转化成了理解、决策或行动？
- Agent 修改了哪些文件，结果是否合法、是否需要人工确认？
- 目标、项目、任务、每日计划和周期复盘如何保持同一条证据链？
- 一套不断增加的 Prompt、Skill 和自动化如何避免行为漂移？

kos 的核心不是“让 AI 多写一些笔记”，而是把 LLM 放进一个有上下文、状态、工具、反馈和人工业务边界的工作环境中。

```text
用户目标
  -> kos-agent 读取相关 Context 与 Skill
  -> LLM 判断、取舍、规划或生成
  -> Harness 执行确定性写入与状态流转
  -> Validator / Eval 返回真实反馈
  -> Agent 修正，或等待用户作出业务判断
  -> Obsidian 驾驶舱实时反映 Vault 状态
```

## 核心工作流

### 从目标到每天的行动

```text
半年 Goal
  -> Project 组合与成功指标
  -> 公共 Task Pool
  -> Agent 生成最多三项今日建议
  -> 用户接受、调整、推迟或拒绝
  -> 执行结果与 Project 贡献
  -> 日终、周度和月度复盘
```

Goal 的投入占比、激活、达成和结果定义变化属于人的业务判断。Agent 可以分析和提出建议，但不能把“任务做完”冒充“目标已经取得结果”。

详见 [半年目标与推进](vault/90_系统/文档/25_半年目标与推进.md) 和 [项目与任务](vault/90_系统/文档/23_项目与任务.md)。

### 从输入到知识

```text
Inbox / Source
  -> Extract
  -> Summary
  -> Research
  -> Concept / Method
  -> 被 Project、Task 或新的判断实际使用
```

Source 尽量保存原始信息；Extract 保留忠实证据；Summary 和 Research 明确 AI 生成与人工审阅状态；Concept 和 Method 只有经过来源、理解与实践验证后，才逐步成为可信资产。

详见 [输入到知识](vault/90_系统/文档/26_输入到知识.md) 和 [对象模型与模板](vault/90_系统/文档/20_对象模型与模板.md)。

### 从阅读到应用

kos Reader 支持 Source Markdown、本地有文字层 PDF 和无 DRM EPUB。阅读进度保存在插件私有数据中；划线和彩色批注写入关联 Extract，重新打开后仍可恢复。

![真实 kos Reader 与 Agent](vault/90_系统/文档/assets/readme/kos-reader-real.png)

选区、当前页或章节、本次阅读会话可以预填到全局 Agent 输入框，由用户检查后再发送。阅读产物可以继续进入 Summary、Research、Concept、Method 或 Project。

详见 [读书与阅读](vault/90_系统/文档/24_读书与阅读.md)。

### 与 Agent 协作

kos-agent 不是独立聊天窗口，而是 kos 的正式运行后端：

- 读取 `.kos.md`、Vault 对象、Skill、当前笔记、选区、`@mention` 与界面上下文。
- 复用 Pi 的模型接入、Agent loop、Session、compaction、资源加载和通用工具。
- 通过扩展 RPC 与 Obsidian 交换消息、工具事件、问题、diff、validation 和 session 状态。
- 支持 steering、follow-up、Stop、`ask_question`、Web 搜索、Session 恢复、分叉和压缩。
- 只有 YOLO 一种工具执行模式，不提供逐工具审批开关。

YOLO 表示工具调用不逐次询问权限，不表示 Agent 可以替用户确认目标、事实、审阅结论或最终价值判断。

详见 [驾驶舱](vault/90_系统/文档/27_驾驶舱.md)、[Agent 协作](vault/90_系统/文档/28_Agent协作.md) 和 [Agent 后端](vault/90_系统/文档/70_Agent后端.md)。

## 产品界面

### 单页驾驶舱

驾驶舱把五张工具卡和六个业务区块放在同一张响应式 Bento 页面中：

- 工具卡：点阵时钟、当日任务时刻、H1/H2 Goal、年度进度、365 天活动热力图。
- 今日：确定性事实、需要关注、Agent 建议、接受/调整/推迟/拒绝。
- 行动：Project、Task Pool、今日任务、阻塞和归档候选。
- 输入：Source 管道、积压、收件箱和处理入口。
- 知识：Research、Concept、Method 与成熟度。
- 审阅与复盘：待审阅对象、周月复盘、趋势和成就。
- 系统：Validator、kos-agent 状态、Skill 与 Eval。

十一张卡均可拖动、按整数格缩放、碰撞避让、撤销、重做和恢复默认。打开、滚动或刷新驾驶舱不会自动调用模型，只有明确的 Agent 动作才会产生模型请求。

### Agent 侧栏

Agent 始终位于 Obsidian 右侧栏，可以与驾驶舱、Reader 和普通 Markdown 笔记同时工作。工具调用、进度、错误和 diff 在对话中可见；用户可以在运行中追加信息、改变方向或停止任务。

### 独立 Reader

Reader 是独立的中央 `ItemView`，不嵌入驾驶舱。EPUB 可以直接从文件树打开；PDF 默认保持 Obsidian 原生行为，需要时通过右键菜单或命令进入 kos Reader。

## 为什么不只是一个 Obsidian 模板

| 层 | 职责 |
|---|---|
| Markdown Vault | 用户可读、可编辑、可导出的数据与声明式契约 |
| kos-agent | 模型接入、Agent loop、Session、Context、Tools、Skills 和反馈循环 |
| Harness | 状态机、原子操作、Validator、Task Contract、Skill Eval |
| kos Companion | 驾驶舱、Agent UI、Reader、直接操作和运行状态 |
| Development Harness | Process Eval、发行检查、同步和回归测试 |

kos 对 `Agent` 的定义是：

```text
Agent = LLM + Harness
```

LLM 负责推理和生成。Harness 决定模型看见什么、能做什么、状态如何保存、失败如何反馈、用户如何观察和控制，以及什么才算真正完成。

## 快速开始

### 环境要求

- Obsidian Desktop 1.5+
- Node.js 22.19+，仅桌面 kos-agent 需要
- 一个受支持的模型 provider 与 API key
- macOS、Windows 或 Linux 桌面环境；移动端可以使用不依赖本地 Agent 的 Vault 和驾驶舱能力

### 初始化一个 Vault

```bash
git clone https://github.com/Asong6824/kos-framework.git
cd kos-framework
python3 dev/harness/init_vault.py ~/kos
```

不要直接在本仓库的 `vault/` 中保存个人笔记。`vault/` 是运行时发行模板，个人内容应位于单独的 Vault。

### 构建并安装 kos Companion

```bash
make mvp-package
```

将 `release/kos-companion/` 复制到：

```text
<Vault>/.obsidian/plugins/kos-companion
```

在 Obsidian 中启用或重新加载 kos Companion，然后打开右侧 kos Agent 配置 provider、model ID 和 API key。API key 由 kos-agent 的配置层保存，不写入 Markdown 笔记。

### 完成第一次系统检查

可以从 Agent 侧栏或驾驶舱运行，也可以从 Vault 根目录执行：

```bash
node .obsidian/plugins/kos-companion/kos-agent/dist/kos-harness.mjs validate
```

### 尝试第一个工作流

```text
帮我开始今天的工作。读取当前 H1/H2 Goal、Project、Task Pool 和最近复盘，
根据我今天可用的时间给出最多三项建议；先让我确认，不要直接替我排期。
```

更多步骤见 [快速开始](vault/90_系统/文档/00_快速开始.md)。

## 功能地图

| 能力 | 主要入口 | 产物或结果 |
|---|---|---|
| 快速捕获 | Ribbon / 命令面板 | Inbox |
| 输入登记 | Agent / 驾驶舱 | Source |
| 摘录与摘要 | Reader / Agent | Extract、Summary |
| 研究与知识 | Agent | Research、Concept、Method |
| 半年规划 | Agent / 驾驶舱 | Goal 与投入占比 |
| 项目推进 | 驾驶舱 / Agent | Project、Task、指标与证据 |
| 每日规划 | “开始一天” | 推荐、确认后的 Daily Plan |
| 日终和周期复盘 | “结束一天” / 周月报 | Diary、Reflection、周期复盘 |
| 深度阅读 | kos Reader | 进度、划线、批注、Agent Context |
| 个人协作画像 | Agent / 待审核中心 | Personal Operating Profile draft |
| 系统治理 | 系统区 / CLI | Validator、Task Eval、Skill Eval |
| Framework 更新 | Development Harness | 可预览、可审查的单向同步 |

## 文档

### 从这里开始

- [快速开始](vault/90_系统/文档/00_快速开始.md)
- [驾驶舱](vault/90_系统/文档/27_驾驶舱.md)
- [Agent 协作](vault/90_系统/文档/28_Agent协作.md)
- [日常规划与复盘](vault/90_系统/文档/29_日常规划与复盘.md)

### 核心工作流

- [半年目标与推进](vault/90_系统/文档/25_半年目标与推进.md)
- [项目与任务](vault/90_系统/文档/23_项目与任务.md)
- [日常规划与复盘](vault/90_系统/文档/29_日常规划与复盘.md)
- [输入到知识](vault/90_系统/文档/26_输入到知识.md)
- [读书与阅读](vault/90_系统/文档/24_读书与阅读.md)
- [个人操作画像](vault/90_系统/文档/22_个人操作画像.md)

### 系统与扩展

- [目录结构](vault/90_系统/文档/10_目录结构.md)
- [对象模型与模板](vault/90_系统/文档/20_对象模型与模板.md)
- [对象生命周期](vault/90_系统/文档/21_对象生命周期.md)
- [Harness 与系统检查](vault/90_系统/文档/30_Harness与系统检查.md)
- [Skill 管理与防腐](vault/90_系统/文档/40_Skill管理与防腐.md)
- [Skill Eval 与防腐](vault/90_系统/文档/41_Skill Eval与防腐.md)
- [扩展与个人化](vault/90_系统/文档/50_扩展与个人化.md)
- [Framework 同步](vault/90_系统/文档/60_Framework同步.md)
- [Agent 后端](vault/90_系统/文档/70_Agent后端.md)
- [故障排查](vault/90_系统/文档/90_故障排查.md)

开发设计、取舍和内部协议位于 `dev/docs/`、`agent/docs/` 和 `ob-plugin/docs/`，不会随 Runtime Vault 作为用户手册分发。

## 仓库结构

```text
kos-framework/
  vault/       # 复制给用户的 Markdown Runtime Distribution
  agent/       # 官方 kos-agent，基于 pi-coding-agent 的 source fork
  ob-plugin/   # kos Companion Obsidian 插件
  dev/         # 开发 Harness、Process Eval、同步、发行检查和设计文档
  release/     # 生成的 kos Companion 发布产物
```

个人 Vault 与源码仓库分离：

```text
~/kos/
  00_工作台/
  10_收件箱/
  11_原材料/
  20_处理区/
  21_研究/
  22_知识库/
  30_目标/
  31_项目/
  32_任务/
  40_日记/
  80_Skills/
  90_系统/
```

## kos-agent 与上游 Pi

kos-agent 不是从空目录重写的 Agent，也不是对 Pi API 的薄包装。仓库固定并 vendor 了 Pi 的 `pi-ai`、`pi-agent-core` 和 `pi-coding-agent` 源码；`pi-coding-agent` 被导入为 `agent/packages/kos-agent`，再针对 kos 的产品边界改造。

默认复用：provider、模型目录、Agent loop、Session、compaction、资源加载、通用工具、extension 和 RPC 基础。

kos 主要维护：Vault Context、对象与工作流、YOLO 产品入口、Obsidian RPC、Reader 写入、Validator、Task/Skill Eval 和 UI 集成。

确切上游 commit、许可证和本地补丁见 [Pi upstream snapshot](agent/upstream/README.md)。

## 开发与验证

常用检查：

```bash
make check
make test
make agent-check
make ob-plugin-check
make release-check
```

真实 Obsidian E2E：

```bash
npm run test:e2e --prefix ob-plugin
```

`make release-check` 同时覆盖 Runtime 校验、开发 Harness、测试 Vault 初始化、敏感信息扫描、Agent 构建与测试、插件构建与测试以及发布打包。

## 当前边界

- kos-agent 当前只作为 Obsidian Desktop 的正式 Agent 后端；移动端不启动本地完整 Agent。
- Reader 不处理 DRM，不提供电子书商店或版权内容分发。
- Web 搜索需要当前模型能力或用户配置的 Brave / Exa。
- Validator 能证明结构、状态和值域是否合法，不能证明某项用户业务确认真的发生过。
- AI 生成的知识默认保持 draft 或待审阅，不能自动成为用户已经认可的结论。
- Markdown 保持为真相源；Session、缓存和模型配置不替代 Vault 中的长期知识对象。

## License

kos-framework 使用 MIT License。vendored Pi 和其他第三方组件的来源、版本与许可证见对应 `THIRD_PARTY_NOTICES.md` 和 `agent/upstream/`。
