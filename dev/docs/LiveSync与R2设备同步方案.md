# kos-sync：基于 LiveSync 与 R2 的设备同步方案

> 状态：产品边界已收敛，开始实现；尚未进入 runtime 发布。
> 范围：个人 kos Vault 在桌面端与移动端之间的设备同步。  
> 初版日期：2026-07-22；当前决策：2026-07-29。

本文是 Framework Development 文档，用于记录选型、源码采用、产品边界、实现阶段和验收方案。它不是已发布的用户功能，也不应作为当前 runtime 操作指南。完成实装、移动端实机验证、故障演练和发布评审后，再向 `vault/90_系统/文档/` 提炼用户文档。

## 1. 需求分类

本需求属于 **integration**：

- 同步对象是个人 kos Vault，不是 `kos-framework/vault/` 分发源。
- 框架更新仍然使用 `kos-framework/vault/ -> personal kos Vault` 的单向同步。
- 设备同步属于 kos Companion integration，不是 kos-agent 的内建存储层。
- kos 不从零实现同步协议；对象存储 Journal、分块、冲突和恢复能力从 Self-hosted LiveSync 的固定源码版本继承。
- 桌面端保留完整 kos-agent 能力；移动端不需要 Agent、Node.js、模型凭据或 Session。

## 2. 目标和非目标

### 2.1 目标

- 桌面端和移动端共享同一套个人 Markdown Vault。
- 桌面 Agent 写入的长期结果可在移动端阅读和编辑。
- 移动端变更可在桌面端自动追平。
- 日常使用不需要 Git commit、push 或 pull。
- 桌面和移动端只安装 kos Companion，不要求用户另装或理解 Self-hosted LiveSync。
- 同步状态、积压、冲突和错误在 kos 看板中可见。
- 正常同步只有一种自动模式，不暴露 Journal、checkpoint、chunk、CORS 等内部选项。
- 普通个人 Vault 的月度存储成本低于 Obsidian Sync Standard。
- 同步不引入 kos-agent 凭据、Session 和可执行文件的设备扩散。

### 2.2 非目标

- 不承诺 Obsidian 完全退出后在 iOS 持续后台运行。
- 不将同步当作备份或历史版本系统。
- 不在本阶段提供多人协作和同一笔记的高并发编辑。
- 第一版不支持 CouchDB、WebRTC、通用 S3、MinIO 或其他对象存储。
- 第一版不提供端到端加密或路径混淆；R2 中的同步数据不是端到端密文。
- 不把 R2 Access Key、Secret 或设备配对载荷写入 Vault、Git、日志或 framework 发布物。
- 不把自动同步扩展成自动执行“本机覆盖远端”“远端覆盖本机”“清空远端”等真相源决策。
- 同一个 Vault 只允许 kos-sync 一个双向同步引擎；不得与 iCloud、
  Obsidian Sync、Syncthing、Remotely Save 或 Git 自动同步并行运行。

## 3. 候选结论

确定的产品形态是：

```text
桌面 Obsidian + kos Companion(kos-sync) + kos-agent
                            |
                 LiveSync Journal 核心
                            |
                   private R2 bucket
                            |
                 LiveSync Journal 核心
                            |
              移动 Obsidian + kos Companion
```

实现决策：

- 不把完整 Self-hosted LiveSync 插件作为运行时依赖，也不嵌入其设置页、通知和多后端产品外壳。
- 以固定的 Self-hosted LiveSync 与 `livesync-commonlib` revision 建立受控源码 fork。
- 采用对象存储所需的 Journal、分块、去重、变更复制、冲突和恢复实现，并保留对应上游测试。
- kos 只实现 Obsidian/R2 adapter、固定策略、凭据管理、生命周期、看板状态和简化配置。
- 在 Obsidian 前台通过启动、保存、打开文件、恢复联网和周期任务触发同步。
- R2 不需要自行运维 CouchDB、TLS、域名和持久化主机。

R2/S3-compatible Object Storage 不提供 CouchDB 式持续变更流，因此第一版不是操作系统后台推送。iPadOS 挂起 Obsidian 时不承诺继续同步；重新打开后必须自动追平。

## 4. 依赖来源与采用前置

### 4.1 Self-hosted LiveSync

| 项目 | 结论 |
|---|---|
| 来源 | [vrtmrz/obsidian-livesync](https://github.com/vrtmrz/obsidian-livesync) |
| 调研版本 | `0.25.83` |
| 许可 | MIT |
| 维护状态 | 持续维护，有大量社区用户；仍存在较多 issue，上线前必须锁定并验证具体版本 |
| 发布方式 | kos Companion 内置受控源码 fork；用户不单独安装 LiveSync |

源码采用必须满足：

- 固定 LiveSync tag/commit、`livesync-commonlib` commit、导入日期、许可证和依赖版本。
- 上游源码与 kos adapter 分离；禁止把上游代码散复制进普通业务目录后失去来源。
- 保留对象存储、无加密、双 Vault 复制和冲突相关的上游测试。
- 检查发布包、依赖树、构建来源、更新机制和移动端兼容性。
- 检查 R2 Secret 和设备配对载荷的本地存储与日志暴露面。
- 检查删除、重命名、大文件、多字节文件名和 Obsidian 链接的行为。
- 每次更新先审上游 diff，再运行上游保留测试、kos-sync 测试和实机矩阵。

### 4.2 Cloudflare R2

| 项目 | 结论 |
|---|---|
| 来源 | [Cloudflare R2](https://developers.cloudflare.com/r2/) |
| 接口 | S3-compatible API |
| 数据边界 | 私有 Bucket；同步内容不做端到端加密 |
| 凭据 | 只读写单个 Bucket 的最小权限 Token |
| 网络 | 中国大陆移动网络和多个 Wi-Fi 环境需实测 |

不应为规避 CORS 而将 Bucket 设为公开。应优先使用 LiveSync 当前版本支持的 custom request handler 或经审查的 CORS 配置。

取消端到端加密意味着 Cloudflare 账户管理员和任何取得 Bucket 读取权限的人可以读取 Vault 内容。这个边界必须在启用页和用户文档中直接说明。传输仍只允许 HTTPS；R2 凭据仍是 Secret。第一版设备加入码不是加密容器，它包含同一 Vault ID 和 R2 凭据，只允许经可信设备间剪贴板临时传递，导入后应清空剪贴板。

## 5. 成本模型

Cloudflare R2 截至 2026-07 的 Standard 每月免费额度：

| 项目 | 免费额度 |
|---|---:|
| 存储 | 10 GB-month |
| Class A 操作 | 100 万次 |
| Class B 操作 | 1000 万次 |
| 公网下行流量 | 免费 |

超出免费额度后，Standard 存储为 `0.015 美元/GB-month`，Class A 为 `4.50 美元/百万次`，Class B 为 `0.36 美元/百万次`。不考虑超额请求时：

| Vault 远程体量 | 估算存储成本 |
|---|---:|
| 10 GB 以内 | `0 美元/月` |
| 20 GB | 约 `0.15 美元/月` |
| 100 GB | 约 `1.35 美元/月` |

这些数字只证明存储单价有可能低于 Obsidian Sync，不能代表实际总成本。必须在试运行中采集真实 Class A/Class B 请求量、存储增长、日志和人工维护时间。上线前重新核对 [R2 Pricing](https://developers.cloudflare.com/r2/pricing/)。

## 6. 数据边界

### 6.1 应进入设备同步

- 收件箱、输入源、摘录、摘要、研究、知识、日记、目标、项目、任务和方法等 Markdown 内容。
- 用户明确选择的图片、PDF 和 EPUB。
- Agent 已经回写 Vault 的长期结果。
- Framework 已经单向更新到个人 Vault 中的普通可见文件。

### 6.2 必须保留在桌面端

- kos-agent 可执行文件。
- `~/.kos-agent/agent/auth.json` 中的模型 provider 凭据。
- kos-agent 模型配置、全局设置和 Session。
- kos Companion 桌面发布包、工作区布局和插件缓存。
- `.git/`、Framework 备份和 Eval 产物。

kos-sync 不提供 Hidden File Sync 和 Customisation Sync。`.obsidian/`、`.kos.md` 和 `.hermes.md` 不进入设备同步。移动端不运行 Agent，因此不需要 Vault 根标记。插件私有 `data.json` 含 R2 凭据，也不得被 kos-sync 读取为同步对象。

### 6.3 当前实现断层

当前 kos Companion 将 Session 目录设为：

```text
<Vault>/.obsidian/kos-agent/sessions
```

只要 Hidden File Sync 保持关闭，它在本方案中不会进入设备同步。但这仍然把 Agent Session 放在 Vault 配置目录中，会依赖每个同步引擎的隐藏文件规则。在对外承诺“Agent 状态只留桌面”前，应改为类似：

```text
~/.kos-agent/agent/sessions/<vault-id>/
```

Vault ID 的生成、重命名和迁移方案需单独设计，不应直接使用可变的 Vault 文件夹名。

## 7. 产品形态

第一版：

- 桌面端：Obsidian + kos Companion（看板、kos-sync、kos-agent host）。
- 移动端：Obsidian + kos Companion（看板、Reader、捕获、kos-sync；不启动 kos-agent）。
- 两端使用同一个 Vault 内容契约和同一个 R2 Journal。
- 发布前必须证明移动包不会加载 Node built-in、kos-agent host 或桌面 Session；不能只依赖入口隐藏。

### 7.1 单一自动模式

启用后固定执行：

- 启动时拉取并追平。
- 保存、创建、删除和重命名后批量上传。
- 打开文件时请求一次轻量追平。
- Obsidian 前台期间周期同步。
- 网络恢复后自动重试，插件重启后恢复未完成任务。
- 简单文本冲突自动合并；无法安全合并时保留明确的冲突副本并在看板报警。

用户日常只看到“立即同步”和“暂停/继续”。分块大小、checkpoint、Journal epoch、并发、重试和 R2 region 固定由 kos 管理。

### 7.2 首次设置

创建同步只要求：

1. Cloudflare Account ID。
2. Bucket 名称。
3. R2 Access Key ID。
4. R2 Secret Access Key。

kos 自动生成稳定 Vault ID 和 Bucket Prefix，并固定 endpoint、`region=auto`、同步触发、排除与冲突策略。加入已有 Vault 使用单个 `KOS-SYNC1` 加入码，不要求用户重新填写内部参数。加入码只做版本化 Base64URL 编码，不提供加密或防泄露能力。

### 7.3 看板状态

同步状态统一为：

- `disabled`：未启用。
- `initializing`：首次建立本地数据库或获取远端。
- `syncing`：正在发送或接收。
- `up-to-date`：本地与已知远端一致。
- `offline`：网络不可用，本地变更安全排队。
- `paused`：用户暂停。
- `conflict`：存在需要人工处理的冲突。
- `error`：凭据、协议、远端或本地数据库错误。

看板显示最后成功时间、待上传、待应用、冲突数和一条可执行错误，不显示 Secret、对象 key 或完整请求。

## 8. 实现阶段

### Phase A：源码采用与本地可执行闭环

1. 固定并记录 LiveSync、`livesync-commonlib`、许可证和依赖。
2. 切出对象存储无加密路径，删除 kos 不采用的产品入口。
3. 建立 kos-sync service、固定 policy、R2 adapter、设置迁移和看板状态。
4. 使用本地 S3 fixture 完成双 Vault 创建、修改、删除、重命名和冲突闭环。
5. 保留上游对象存储测试并增加 kos 策略测试。

Phase A 不修改 runtime 用户文档，不使用真实凭据生成可提交产物。

### Phase B：R2 与移动实机验证

1. 使用脱敏的一次性测试 Vault 和私有 R2 Bucket。
2. 验证桌面与真实 iPad 的初次加入、双向复制和前后台恢复。
3. 验证 kos Companion 移动包不包含或加载桌面 Agent 能力。
4. 对异常断网、Token 撤销、R2 限额、损坏远程和重建方向做故障演练。
5. 连续试运行至少 7 天，收集延迟、失败率、请求量和存储增长。

当前实现进度（2026-07-31）：

- 已为每个桌面 Vault 在 kos Companion 私有 `data.json` 中生成稳定、不可编辑的 `agentVaultId`。
- kos-agent Session 已改存到 `~/.kos-agent/agent/sessions/<agentVaultId>/`，不再依赖 Vault 名称或路径。
- kos Companion 在桌面端加载时会迁移旧 `.obsidian/kos-agent/sessions`；迁移前先持久化 `agentVaultId`，目标同名文件内容不一致时停止迁移并保留旧目录，禁止静默覆盖。
- 已补路径隔离、原子移动、非冲突合并和冲突保留测试。
- 已把 Self-hosted LiveSync `0.25.83` 与 `livesync-commonlib`
  `bbf2539d00af4846e3e1640e72460fb7ed930ca5` 的未修改源码快照保存到
  `ob-plugin/upstream/livesync/source/`，同时保留许可证、版本和采用边界。
- 已完成 kos-sync 状态模型、固定策略、R2 transport、设置页和看板状态，
  并在插件生产入口连接实际 `KosLiveSyncEngine`。
- 已直接运行固定快照中的 `JournalSyncCore` 测试，并新增两个独立 PouchDB
  Vault 经共享无加密 Journal 完成创建、修改和删除的采用测试。
- 已把现有 R2 transport 适配到上游 `IJournalStorage` 契约；PouchDB 9 的
  间接 `uuid` 依赖覆盖为 `11.1.1`，生产依赖审计为 0 漏洞。
- 已建立不引入上游 UI/CouchDB/P2P 外壳的 `LiveSyncLocalDB` 窄适配器；
  原版 manager 已验证分块、读取、tombstone，以及 Unicode Markdown 经
  Journal 传输后在第二个 Vault 数据库完整重建。
- 已把窄适配器编入移动端目标生产 bundle，并连接 Obsidian 二进制 Vault
  I/O、持久化 IndexedDB/checkpoint、R2 Journal、启动/文件事件/联网恢复/
  45 秒周期触发；E2EE、路径混淆和 worker 路径被固定关闭。
- 两个持久化 IndexedDB 设备经共享对象存储的生产边界测试已覆盖创建、修改、
  并发编辑冲突副本和删除；删除与并发编辑相遇时主路径删除、编辑副本保留。
  删除场景连续回归 3 次通过。
- 已提供一步式设备加入码：首台设备复制，iPad 从可信剪贴板粘贴后获得相同
  Vault ID、Bucket prefix 和 R2 凭据。加入码明确标记为未加密敏感信息，不写入
  Vault、日志或仓库；移动端剪贴板读取失败时回落为手动粘贴 Modal。
- checkpoint 状态经过版本和字段校验。损坏文件先隔离为
  `sync-state.json.corrupt-<timestamp>` 再从 Vault 与 R2 重建；隔离失败时停止
  且不覆盖原文件。编解码、隔离成功和只读失败均有回归测试。
- `make ob-plugin-check` 当前通过：普通测试 198 项通过、2 项跳过，
  LiveSync 专项 10 项通过，TypeScript 和生产构建通过；生产依赖审计和敏感
  信息扫描均为 0 问题。
- 隔离临时 Vault 的 Obsidian CDP 产品 E2E 通过，覆盖插件加载、看板、移动
  单列布局、Reader、Agent 和对象流转，证明同步接入未破坏现有产品入口。
- 发布构建生成 `release/kos-companion` 桌面包和不含 Node/kos-agent host 的
  `release/kos-companion-mobile` iPad 包；两者均携带 LiveSync、
  livesync-commonlib 和 Apache-2.0 许可证，当前大小约 23 MB 与 2.4 MB。
- `make release-check` 于 2026-07-31 完整通过：framework Harness、
  distribution、core/process eval、开发测试、Agent 测试、插件/LiveSync
  测试、敏感扫描和桌面/移动发布包 smoke 均通过。
- 已提供不进入默认回归的 `npm run test:r2-live --prefix ob-plugin`。它只从
  `KOS_R2_ACCOUNT_ID`、`KOS_R2_BUCKET`、`KOS_R2_ACCESS_KEY_ID` 和
  `KOS_R2_SECRET_ACCESS_KEY` 读取一次性测试凭据，以随机 Vault ID 建立隔离
  prefix，完成后删除该 prefix 中的测试对象；测试和错误输出不得打印凭据。
- 2026-07-31 已用私有 Cloudflare R2 Bucket 完成真实双设备测试：协议参数、
  SigV4、上传、列表、下载、反向修改、删除传播和随机 prefix 清理全部通过。
  首次运行捕获并修复了 `StartAfter=undefined` 被拼为字面量、导致新设备漏列
  Journal 的真实 adapter 缺陷；该行为已有单元回归。
- 2026-07-31 又完成了从源码安装器开始的全新用户复演：两个独立 KOS Vault、
  两个隔离 Obsidian profile、设置页加入码、真实 R2 创建/反向修改/删除、
  凭据清理和随机 prefix 清理连续两轮通过。复演新增 Runtime 模板、用户文档
  和 Core Skill 数量守恒断言，不能再用单个测试文件往返代表 Vault 完整。
- 该复演捕获了两个会造成批量删除的缺陷：旧 checkpoint/reflection 没有绑定
  Vault ID；预填充第二个 Vault 在首次接收前先写入本地数据库，产生的冲突
  revision 清理被下一轮 Journal 当作全文件 tombstone。当前分别通过 checkpoint
  schema v2 Vault ID 隔离，以及“远端非空时先拉取、同内容去重、异内容冲突副本、
  再上传本地独有文件”修复，并有专项回归。
- 2026-07-31 已在实体 iPad、本地 Obsidian Vault 和私人 R2 上完成首次安装、
  加入、Runtime 拉取与完整目录骨架验证。真机验收捕获并修复了三类桌面模拟
  未覆盖的问题：移动 bundle 残留顶层 Node `events` 依赖；Obsidian
  `vault.getFiles()` 不返回 `.gitkeep`，导致空目录骨架不出现；新 Obsidian
  profile 的 IndexedDB 为空时复用 Vault 旧 checkpoint，造成新增记录被静默
  判定为已发送。三者分别由移动 bundle 阻断检查、adapter 隐藏文件遍历、
  “空数据库 + 非空旧状态”安全远端优先重建及专项回归覆盖。
- 真机还确认加入码通过聊天手工选择时可能被截断。Runtime 现在使用独立的
  `66_多端同步故障排查.md` 按症状指导用户，加入窗口显示粘贴字符数，解析错误
  明确提示重新整行复制。加入码仍不是加密或短时密码，暴露后必须轮换 R2 凭据。
- `verify_new_user_sync.mjs` 默认仍清理随机 R2 前缀和凭据。只有显式同时设置
  `KOS_NEW_USER_PRESERVE_REMOTE=1` 与物理验收参数时才保留远端；
  `KOS_NEW_USER_SOURCE_ONLY=1` 只用于已选定源 Vault 的物理设备追平，并强制要求
  preserve 模式，避免误清理。
- 已新增 runtime 用户文档 `65_多端同步.md` 和专门的
  `66_多端同步故障排查.md`。仍需完成断网、Token 失效、冲突、恢复/重建、
  大附件和移动安装渠道验收；完成前不得宣称设备同步正式发布。

### Phase C：发布与用户文档

1. 固定已验证的 LiveSync 版本和支持范围。
2. 记录当时的 R2 定价和可能超额的请求模型。
3. 把稳定的用户操作提炼到 `vault/90_系统/文档/`，不携带开发过程、实验参数或凭据。
4. 补故障排查、备份恢复、单同步引擎限制和移动后台边界。
5. 运行 `make release-check` 后才进行下游同步或发布。

## 9. 必须验收的场景

### 9.1 基本复制

- 桌面创建、修改、重命名和删除 Markdown，移动端结果一致。
- 移动创建、修改、重命名和删除 Markdown，桌面端结果一致。
- 图片、PDF 和 EPUB 在预定大小内正确同步。
- 中文、空格、组合 Unicode 和较长路径不产生重复。

### 9.2 断网和冲突

- 移动端完全退出后，重新打开可自动追平。
- Wi-Fi 和移动网络切换后可恢复。
- 两端断网修改不同文件，重连后两份变更都保留。
- 两端修改同一 Markdown，简单冲突可合并，不可合并冲突会留下明确人工处理线索。
- 桌面 Agent 连续原子更新关联对象时，移动端不会长期保留半完成状态。

### 9.3 安全与隔离

- R2 Bucket 不公开，Token 只能读写单个 Bucket。
- 远程对象内容与路径泄露面符合“无端到端加密”的已披露边界。
- 移动端只有 R2 同步凭据，没有模型 provider 凭据、kos-agent Session 或 kos-agent host。
- `.obsidian/`、`.kos.md`、`.hermes.md` 不进入 R2。
- 日志、截图、Eval artifact 和问题报告不包含 Secret 和完整设备配对载荷。

### 9.4 成本与可运维性

- 收集 7 天真实的 R2 存储、Class A 和 Class B 请求量。
- 建立 1 GB、10 GB、20 GB 和含大附件 Vault 的成本推算。
- 主动模拟 Token 失效、超额和服务端错误，用户能看到失败，不得静默丢失变更。
- 不依赖 kos 团队维护长期运行的共享 CouchDB 服务。

## 10. 备份和故障演练

LiveSync 和 R2 不能替代备份。误删除、错误覆盖或损坏数据可能被快速复制到所有设备。发布前必须证明：

- 桌面 Vault 有每日增量备份。
- 至少有一份不和 LiveSync 共享删除链路的异地备份。
- 可以从备份恢复到隔离 Vault，通过 Validator 后再重建远程。
- 故障止损顺序固定为：两端暂停同步 -> 停止编辑 -> 分别备份 -> diff -> 选定唯一真相源 -> 重建。
- 没有备份和明确数据方向时，不执行 Rebuild、Overwrite 或 Reset。

## 11. 备选方案与放弃原因

| 方案 | 成本 | 放弃为默认的原因 |
|---|---:|---|
| LiveSync + 自有 CouchDB | 已有 NAS 时接近 0 | 需维护主机、TLS、暴露面、升级和备份；专门购买 VPS 后成本接近官方 Sync |
| Remotely Save + R2 | 通常 0 | 定时或保存触发，免费版冲突能力较弱，自动同步错误可能静默 |
| Syncthing | Android 通常 0 | iOS 缺少官方可维护路径，无法作为跨移动平台默认 |
| Git / Working Copy | 存储可免费 | 需要显式 pull、commit 和 push，不符合无感同步 |
| LiveSync WebRTC | 0 | 当前是实验能力，需要在线 peer 或额外 pseudo-peer |

## 12. 开放决策

发布前还需要明确：

- 第一版官方支持的移动系统是 iOS、Android 还是两者。
- 是否支持同步 PDF/EPUB，或只支持 Markdown 和图片。
- 是否允许用户选择国内 S3-compatible 存储，以及兼容性责任边界。
- PDF/EPUB 的第一版大小上限。
- 是否在第一版加入码之上增加短期失效或单独的凭据交换服务；当前实现依赖
  Cloudflare Token 撤销/轮换和可信设备间剪贴板。
- LiveSync 上游版本升级的负责人、节奏和回退指引。

## 13. 用户文档与正式发布条件

桌面新用户复演通过后可以把已验证步骤写成 runtime 文档草案；只有同时满足
以下条件，才可把该文档作为“同步已正式发布”的依据：

- Phase A 和 Phase B 完成。
- 桌面端、至少一个真实移动平台和中国大陆多网络环境验证通过。
- Agent Session 与凭据设备隔离通过自动检查。
- 冲突、误删除、远程重建和备份恢复演练通过。
- 成本估算使用实际请求和存储数据，不只使用公开单价。
- 用户文档只包含已验证的操作，且经过从零搭建复演。
- `make release-check` 通过。

## 14. 参考

- [Self-hosted LiveSync](https://github.com/vrtmrz/obsidian-livesync)
- [Self-hosted LiveSync CouchDB setup](https://github.com/vrtmrz/obsidian-livesync/blob/main/docs/setup_own_server.md)
- [Cloudflare R2 Pricing](https://developers.cloudflare.com/r2/pricing/)
- [Cloudflare R2 S3 API](https://developers.cloudflare.com/r2/api/s3/)
- [Obsidian: Sync your notes across devices](https://obsidian.md/help/sync-notes)
