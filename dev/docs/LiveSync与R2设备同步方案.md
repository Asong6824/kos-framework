# LiveSync 与 R2 设备同步方案

> 状态：调研与待实现设计，尚未进入 runtime 发布。  
> 范围：个人 kos Vault 在桌面端与移动端之间的设备同步。  
> 文档日期：2026-07-22。

本文是 Framework Development 文档，用于记录选型、边界、实现前置和验收方案。它不是已发布的用户功能，也不应作为当前 runtime 操作指南。完成实装、移动端实机验证、故障演练和发布评审后，再向 `vault/90_系统/文档/` 提炼用户文档。

## 1. 需求分类

本需求属于 **integration**：

- 同步对象是个人 kos Vault，不是 `kos-framework/vault/` 分发源。
- 框架更新仍然使用 `kos-framework/vault/ -> personal kos Vault` 的单向同步。
- 设备同步不应成为 kos-agent 的内建存储层，也不应在 kos-agent 中重新实现文件同步协议。
- 桌面端保留完整 kos-agent 能力；移动端不需要 Agent、Node.js、模型凭据或 Session。

## 2. 目标和非目标

### 2.1 目标

- 桌面端和移动端共享同一套个人 Markdown Vault。
- 桌面 Agent 写入的长期结果可在移动端阅读和编辑。
- 移动端变更可在桌面端自动追平。
- 日常使用不需要 Git commit、push 或 pull。
- 普通个人 Vault 的月度存储成本低于 Obsidian Sync Standard。
- 同步不引入 kos-agent 凭据、Session 和可执行文件的设备扩散。

### 2.2 非目标

- 不承诺 Obsidian 完全退出后在 iOS 持续后台运行。
- 不将同步当作备份或历史版本系统。
- 不在本阶段提供多人协作和同一笔记的高并发编辑。
- 不在未经实机验证时预装或自动配置第三方同步插件。
- 不把 R2 Access Key、Secret、加密口令或 Setup URI 写入 Vault、Git 或 framework 发布物。

## 3. 候选结论

推荐的验证对象是：

```text
桌面 Obsidian + kos Companion + kos-agent
                       |
             Self-hosted LiveSync
                       |
              private R2 bucket
                       |
             Self-hosted LiveSync
                       |
              移动 Obsidian
```

选择理由：

- Self-hosted LiveSync 支持 Obsidian 桌面端和移动端。
- 支持 CouchDB 和 MinIO、S3、R2 等对象存储。
- 支持端到端加密和简单冲突合并。
- 在 Obsidian 前台运行时可进行近实时复制，比手动 Git 或定时 WebDAV 更接近“无感”。
- R2 不需要自行运维 CouchDB、TLS、域名和持久化主机。

Self-hosted LiveSync 的 WebRTC 点对点模式仍标记为 Experimental，且需要至少一个稳定在线端，不作为第一版产品方案。

## 4. 依赖来源与采用前置

### 4.1 Self-hosted LiveSync

| 项目 | 结论 |
|---|---|
| 来源 | [vrtmrz/obsidian-livesync](https://github.com/vrtmrz/obsidian-livesync) |
| 调研版本 | `0.25.83` |
| 许可 | MIT |
| 维护状态 | 持续维护，有大量社区用户；仍存在较多 issue，上线前必须锁定并验证具体版本 |
| 发布方式 | 优先由用户通过 Obsidian 社区插件安装；默认不 vendoring、不复制源码 |

正式采用前还需要完成：

- 固定版本的移动端兼容性验证。
- 检查发布包、依赖树、构建来源和更新机制。
- 检查 Setup URI、R2 Secret 和端到端加密口令的本地存储与日志暴露面。
- 检查删除、重命名、大文件、多字节文件名和 Obsidian 链接的行为。
- 记录本地修改。kos 不应 fork LiveSync；如必须修改，需先建立来源、版本、许可和可审阅 patch 记录。

### 4.2 Cloudflare R2

| 项目 | 结论 |
|---|---|
| 来源 | [Cloudflare R2](https://developers.cloudflare.com/r2/) |
| 接口 | S3-compatible API |
| 数据边界 | 私有 Bucket；插件端到端加密后上传 |
| 凭据 | 只读写单个 Bucket 的最小权限 Token |
| 网络 | 中国大陆移动网络和多个 Wi-Fi 环境需实测 |

不应为规避 CORS 而将 Bucket 设为公开。应优先使用 LiveSync 当前版本支持的 custom request handler 或经审查的 CORS 配置。

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

LiveSync 的 Hidden File Sync 和 Customisation Sync 在目标方案中必须关闭。`.obsidian/`、`.kos.md` 和 `.hermes.md` 不进入设备同步。移动端不运行 Agent，因此不需要 Vault 根标记。

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

第一版建议：

- 桌面端：Obsidian + kos Companion + kos-agent + Self-hosted LiveSync。
- 移动端：Obsidian + Self-hosted LiveSync。
- 移动端不安装 kos Companion 当前完整发布包。

虽然 kos Companion manifest 当前未标记 `isDesktopOnly`，其发布包仍包含 kos-agent host。如果未来需要移动看板，应先评估建立不包含 Agent host 的 mobile artifact，或证明当前发布包在移动端的存储、安全和加载行为可接受。不应仅依赖运行时平台检查就宣称移动发布已完成。

## 8. 实现阶段

### Phase A：隔离可行性验证

1. 使用脱敏的一次性测试 Vault，不读取真实用户 kos。
2. 创建私有 R2 Bucket 和只读写该 Bucket 的 Token。
3. 固定 LiveSync 版本，在一台桌面设备和至少一台真实移动设备上安装。
4. 启用 LiveSync 端到端加密，关闭 Hidden File Sync 和 Customisation Sync。
5. 完成首轮本地到空远程、空移动 Vault 到远程的方向性测试。
6. 连续试运行至少 7 天，收集延迟、失败率、请求量和存储增长。

Phase A 不修改 runtime 用户文档，不向 `vault/` 分发 LiveSync，不使用真实凭据生成可提交产物。

### Phase B：kos 边界加固

1. 将 kos-agent Session 移出 Vault，补迁移和回归测试。
2. 决定移动端是否只支持原生 Obsidian，还是需要独立 kos Companion mobile artifact。
3. 建立可自动执行的文件变更、删除、重命名和冲突 fixture；真实移动系统限制仍由实机验证。
4. 对异常断网、Token 撤销、R2 限额、损坏远程和重建方向做故障演练。
5. 评审是否需要 kos 侧的检查项，例如发现 `.obsidian/kos-agent/sessions` 正在被同步时报警。

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
- 远程对象不以明文泄露 Vault 内容。
- 移动端只有 R2 同步凭据，没有模型 provider 凭据、kos-agent Session 或 kos-agent host。
- `.obsidian/`、`.kos.md`、`.hermes.md` 不进入 R2。
- 日志、截图、Eval artifact 和问题报告不包含 Secret、加密口令和完整 Setup URI。

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

进入实现前还需要明确：

- 第一版官方支持的移动系统是 iOS、Android 还是两者。
- 是否支持同步 PDF/EPUB，或只支持 Markdown 和图片。
- 是否允许用户选择国内 S3-compatible 存储，以及兼容性责任边界。
- kos 是只提供经验证文档，还是提供不接触凭据的本地预检工具。
- 移动看板是否进入同一里程碑；如果不进入，移动端仅承诺原生 Obsidian 编辑。
- LiveSync 版本升级由谁验证，如何发布已知安全版本和回退指引。

## 13. 用户文档转换条件

只有同时满足以下条件，才可新建 runtime 用户文档：

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
