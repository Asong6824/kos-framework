# 安装 kos

推荐使用 Obsidian Desktop。kos Companion 的看板和 Reader 不调用模型也能使用；kos Agent 需要 Node.js 22.19+ 和模型 API key。

## 方式一：下载完整 Vault（新用户推荐）

只有 [GitHub Releases](https://github.com/Asong6824/kos-framework/releases) 页面实际列出下面的版本化文件时，才使用此方式。页面没有发行文件时，不要下载自动生成的 Source code ZIP 冒充安装包；请改用“方式四：从源码一键安装”，或使用维护者提供的已校验归档。

1. 下载 `kos-vault-<version>.zip`。
2. 解压后用 Obsidian 打开其中的 `kos-user-vault` 文件夹。
3. 进入“设置 → 第三方插件”，关闭安全模式并启用 kos Companion。
4. 全新安装会自动打开首次使用向导；也可从命令面板或 kos Companion 设置重新打开。
5. 按向导打开 kos Agent，配置 provider、model ID 和 API key，并“保存并测试”。
6. 在向导中运行系统检查。成功时应显示 `Harness: PASS`、`Errors: 0`。
7. 按向导建立第一个 Goal、Project 和 Task。

需要在桌面与 iPad 之间同步时，继续按
[`65_多端同步.md`](vault/90_系统/文档/65_多端同步.md)
配置私人 Cloudflare R2。kos Companion 已内置同步能力，不需要另装 LiveSync。
遇到加入码、iPad 加载、目录不全或状态不更新时，使用
[`66_多端同步故障排查.md`](vault/90_系统/文档/66_多端同步故障排查.md)，不要清空 Bucket 或删除同步状态试错。

完整包已经包含 kos Vault 模板和 kos Companion，不需要 Git、`npm install`、`make` 或 Python。Agent 仍需要本机安装 Node.js 22.19+。

## 方式二：为已有 Vault 安装插件

从同一版本的 GitHub Release 下载 `kos-companion-<version>.zip`，创建目录 `<Vault>/.obsidian/plugins/kos-companion`，把 ZIP **里面的内容**解压到该目录。最终应直接看到：

```text
<Vault>/.obsidian/plugins/kos-companion/
  manifest.json
  main.js
  styles.css
  kos-agent/
```

不要在目标目录里再套一层 `kos-companion`。随后用 Obsidian 打开 Vault，并按上一节的第 3–5 步操作。

## 方式三：在 iPad 安装移动包

从同一版本的 GitHub Release 下载 `kos-companion-mobile-<version>.zip`。该 ZIP 不含 Node.js 或 `kos-agent/`，解压后的根目录直接包含：

```text
manifest.json
main.js
styles.css
INSTALL.md
```

最终安装位置仍是 `<Vault>/.obsidian/plugins/kos-companion/`，不能多套一层目录。首次打开后必须在“设置 → 第三方插件”关闭 Restricted Mode，并手动启用 kos Companion。

Obsidian Mobile 设置页本身不能导入任意插件 ZIP。正式面向普通用户发布时应从 Obsidian 社区插件渠道安装；当前移动 ZIP 是可校验的测试发行物，直接写入隐藏插件目录只适合能够管理本地 Vault 文件的测试用户。不要为了安装 kos 去公开 R2 Bucket、越狱设备或安装来源不明的配置工具。

iPad 不运行本地 kos-agent，不需要 Node.js 或模型 API key。同步步骤见 `65_多端同步.md`。

## 方式四：从源码一键安装

前置条件：

- Git
- Node.js 22.19+
- Obsidian Desktop 1.5+
- 一个受支持的模型 provider 与 API key

macOS、Linux 和 Windows PowerShell 使用同一组命令：

```bash
git clone https://github.com/Asong6824/kos-framework.git
cd kos-framework
node dev/harness/install_local.mjs "/path/to/my-kos-vault"
```

Windows 示例：

```powershell
git clone https://github.com/Asong6824/kos-framework.git
cd kos-framework
node dev/harness/install_local.mjs "C:\Users\me\Documents\kos"
```

安装器会自动：

- 检查 Node 版本。
- 向空目录初始化 Vault；已有 `.kos.md` 时保留个人内容。
- 安装锁定版本的构建依赖。
- 构建 kos-agent 和 kos Companion。
- 将插件安装到正确目录。
- 更新时保留插件 `data.json`，并把旧插件备份到 `90_系统/framework-backups/`。
- 运行无模型健康检查。

首次构建需要下载 npm 依赖，耗时取决于网络。重复安装可在确认依赖未变化时使用：

```bash
node dev/harness/install_local.mjs "/path/to/my-kos-vault" --skip-deps
```

## 配置模型

打开 kos Agent，点击“配置模型”并填写：

- provider：模型提供商标识。
- model ID：提供商支持的模型 ID。
- API key：对应提供商的密钥。
- Base URL 和 API 协议：仅自定义中转或自定义模型需要。

使用火山引擎 Coding Plan 时，点击“火山 Coding Plan”预设，只需再填写套餐 API key。预设固定使用：

```text
provider: volcengine-coding-plan
model ID: ark-code-latest
Base URL: https://ark.cn-beijing.volces.com/api/coding/v3
API 协议: OpenAI Completions
```

不要把 Base URL 改成普通方舟推理地址 `https://ark.cn-beijing.volces.com/api/v3`，否则不会消耗 Coding Plan 套餐额度，并可能产生额外费用。点击“保存并测试”后，kos 会发起一条不写入 Session 的最小请求，成功时显示实际路由模型和耗时。

API key 写入 kos-agent 自身配置目录，不写入 Markdown 或 Obsidian `data.json`。不要把密钥放进 Vault、截图、Issue 或 Git。

未配置模型前，Agent 输入框会保持禁用。模型连接测试通过后，首次启动卡会提供“运行系统检查”和“填写第一个工作流”两个入口。

## 验证安装

在 Vault 根目录运行：

```bash
node .obsidian/plugins/kos-companion/kos-agent/dist/kos-harness.mjs validate
```

预期结果：

```text
Harness: PASS
Errors: 0
Warnings: 0
```

然后在 Agent 中尝试：

```text
我是第一次使用 kos，目前可能还没有 Goal、Project 或 Task。先用简短问题了解
我的半年重点、当前事项和今天可用时间；提出最小初始化方案，等我确认后再创建。
```

## 更新

源码安装：

```bash
cd kos-framework
git pull --ff-only
node dev/harness/install_local.mjs "/path/to/my-kos-vault"
```

发布包安装：退出或禁用 kos Companion，临时移出原插件目录，解压新版本，再把旧目录中的 `data.json` 复制回来。不要把仍含相同 `manifest.json` 的备份留在 `.obsidian/plugins/` 内。

Vault 框架内容与插件更新是两个不同步骤。已有个人 Vault 的框架同步见 `90_系统/文档/60_Framework同步.md`，执行前务必查看 dry-run。

## 常见问题

- 插件文件存在但没有入口：首次打开 Vault 后必须进入“设置 → 第三方插件”，关闭 Restricted Mode，再手动启用 kos Companion；安装器不会绕过 Obsidian 的安全确认。
- 找不到 Node：确认 `node --version` 不低于 22.19；也可在 kos Companion 设置中填写 Node 可执行文件路径。
- 插件没有出现：确认目录层级中没有多套一层 `kos-companion/kos-companion`，然后重启 Obsidian。
- 仍显示旧界面：禁用再启用插件，并检查 `.obsidian/plugins/` 下是否残留同 ID 的备份插件。
- Agent 离线：先运行健康检查，再检查 Node 路径、provider、model ID 和 API key。
- Windows 没有 `make` 或 Python：一键安装器不依赖它们。
- R2 字段怎么填：只填写 Account ID、Bucket、Access Key ID 和 Secret Access Key；不要填写完整 endpoint 或 Cloudflare 的 Token value。填写后先点“测试 R2 读写”，通过后才能首次启用同步。

更完整的运行期排查见 `vault/90_系统/文档/90_故障排查.md`。
