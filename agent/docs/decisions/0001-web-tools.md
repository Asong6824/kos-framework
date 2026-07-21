# Web 工具选型

状态：Accepted（2026-07-20）

## 决策

kos-agent v0.2 内建两个工具：`web_search` 和 `web_fetch`。它们作为 Harness 能力直接运行，不经过 MCP，也不要求 Obsidian 插件实现网络协议。

- `web_search` 采用可替换 provider 的薄适配层，首批支持当前 OpenAI Responses 模型的原生 Web Search、Brave Search API 与 Exa Search API。`auto` 模式优先使用显式配置的 Brave/Exa，否则复用兼容的当前模型；也可用 `KOS_WEB_SEARCH_PROVIDER` 显式指定。
- `web_fetch` 复用 `pi-simple-web-tools@0.1.0` 的 HTTP 抓取、正文抽取和 SSRF 防护思路，并吸收 `pi-web-access@0.13.0` 的安全测试边界。
- 只引入正文抽取所需依赖，不引入 TUI、浏览器会话、后台结果仓库、GitHub/视频专用抓取或 MCP。
- 网页正文始终包在不可信内容边界内，明确要求模型忽略其中的指令。

## 社区调研

| 候选 | 结论 | 原因 |
| --- | --- | --- |
| `pi-web-access@0.13.0` | 参考，不整体引入 | provider 丰富且安全测试较完整，但包含 TUI、浏览器 curator、存储和视频等超出当前产品面的功能 |
| `pi-simple-web-tools@0.1.0` | 主要实现来源 | 小、边界清楚，已有 DNS/重定向 SSRF 防护和 Readability 抽取；测试不足由 kos 补齐 |
| `@ollama/pi-web-search@0.0.5` | 不采用 | API 与本地 Ollama 登录强绑定 |
| `@pi-stef/web@0.3.4` | 不采用 | Playwright/CloakBrowser 和关联包使安装与运行面过重 |

实现来源固定到：

- `pi-simple-web-tools` npm `0.1.0`，git `46c8edf2aa4681c607aff27eac9ab74c053ddd88`
- `pi-web-access` npm `0.13.0`，git `7bdc30a65cf77273eb9c0034647b373bda4060d7`

两者均为 MIT，归属文本见 `THIRD_PARTY_NOTICES.md`。

## 安全边界

- 只接受 HTTP/HTTPS，禁止 URL 用户名/密码。
- DNS 所有返回地址均须为公网地址；禁止 localhost、私网、链路本地、文档网段、基准测试网段、组播和保留地址，包括 IPv4-mapped IPv6。
- 每次重定向重新解析并校验，最多五跳。
- HTTP 正文上限 5 MiB，PDF 上限 20 MiB；同时检查 `Content-Length` 和实际读取字节数。
- 默认 30 秒超时，调用方 abort 立即传递。
- 不向目标网页发送搜索 API key；错误响应只截取有限长度，且不得回显凭据。
- DNS 校验不能消除解析后换绑风险。当前实现依赖 Node `fetch` 再次解析主机；发布前测试覆盖已知 SSRF 入口，后续可通过安全 dispatcher 将已验证地址固定到连接层。

## 配置

凭据由 Obsidian 通过 RPC 写入 kos-agent 的 `auth.json`（权限 `0600`），不进入插件 `data.json`。环境变量可用于自动化和临时覆盖：

- Brave：`BRAVE_SEARCH_API_KEY`
- Exa：`EXA_API_KEY`
- provider：`KOS_WEB_SEARCH_PROVIDER=auto|model|brave|exa`，默认 `auto`

当前模型不支持 Responses Web Search 且没有独立搜索凭据时，`web_search` 返回可操作的配置错误；`web_fetch` 不需要凭据。
