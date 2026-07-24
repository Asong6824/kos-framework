# LLM 工作流与确定性写入边界

## 决策

开始一天、结束一天、周期复盘，以及 Goal、Project、Task 的创建、编辑和状态管理，都是语义工作流。标准 Obsidian 入口必须先进入 kos-agent，由 LLM 完成理解、比较、澄清、取舍和证据判断，再使用 Harness 完成确定性读写。

Harness CLI 不包含 LLM。它提供 PlanningContext、对象操作、状态机、Validator、原子写入和回滚，是 Agent 的执行能力层，不是 Agent 判断本身。

## 入口约束

`ob-plugin/src/agent/workflows.ts` 是看板 intent 到 Skill 的统一映射。新增 Goal、Project、Task 或日/周期工作流入口时，必须先在此登记，不得从 UI 直接调用对应确定性 RPC。

发送给 Agent 的用户消息只保留 Skill、必要操作、非空参数和相关对象路径。LLM/Harness 边界属于 Skill 契约，不应在每次用户消息中重复；UI 路由字段、对象标题/类型、空上下文和重复文件引用不得进入 prompt。未知 intent 必须报错，不能退化为通用自然语言提示。

看板语义工作流使用独立 Session，并通过专用工作流通道直接调用 `prompt`。它不得继承 Agent 输入框中的草稿、笔记/选区、图片和 `steer/follow_up` 模式，也不得把选中对象全文预先附加；Agent 根据对象路径按需读取 Vault。待回答问题属于创建它的 Session，切换 Session 时不得继续显示旧问题。

Source 管道进入 `/kos-process-source`，按当前状态只推进一个阶段；Summary 审阅必须等待用户结论。待审对象退回进入 `/kos-revise-object`，没有退回原因先使用 `ask_question`，修订后保持待审状态。

推荐接受、调整、推迟和拒绝是例外：用户已经通过按钮或表单表达了明确决定，插件可以直接提交结构化反馈，避免 LLM 重猜。

## 开始一天

1. `start-day` 构造 PlanningContext 和确定性候选，并把每日计划标为 `generating`。
2. `/kos-start-my-day` 必须由 LLM 比较候选，不能照抄规则排序。
3. LLM 调用 `save-daily-plan` 提交最多三项最终结构化建议。
4. Harness 校验 run ID、Context fingerprint、Task 路径和建议字段，原子更新管理区。
5. 看板只把 `save-daily-plan` 后的内容展示为最终 Agent 建议；中间状态显示“生成中”。

## 验证

- 插件 contract test 覆盖 intent 到 Skill 的映射。
- 插件 workflow runner test 覆盖新 Session、命名、最终 `prompt` 原文和取消边界。
- kos-agent operation test 覆盖生成中状态、最终建议原子写回和 stale run 拒绝。
- core Skill Eval 覆盖日计划、周期复盘、Goal/Project/Task、Source 管道和待审修订的 LLM/Harness 分工。
