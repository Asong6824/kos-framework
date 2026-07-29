# 安装 kos

推荐使用 Obsidian Desktop。kos Companion 的看板和 Reader 不调用模型也能使用；kos Agent 需要 Node.js 22.19+ 和模型 API key。

## 方式一：下载完整 Vault（新用户推荐）

1. 从 [GitHub Releases](https://github.com/Asong6824/kos-framework/releases) 下载 `kos-vault-<version>.zip`。
2. 解压后用 Obsidian 打开其中的 `kos-user-vault` 文件夹。
3. 进入“设置 → 第三方插件”，关闭安全模式并启用 kos Companion。
4. 打开右侧 kos Agent，按首次启动卡配置 provider、model ID 和 API key。
5. 点击首次启动卡中的“运行系统检查”。成功时应显示 `Harness: PASS`、`Errors: 0`。

完整包已经包含 kos Vault 模板和 kos Companion，不需要 Git、`npm install`、`make` 或 Python。Agent 仍需要本机安装 Node.js 22.19+。

## 方式二：为已有 Vault 安装插件

从 GitHub Releases 下载 `kos-companion-<version>.zip`，创建目录 `<Vault>/.obsidian/plugins/kos-companion`，把 ZIP **里面的内容**解压到该目录。最终应直接看到：

```text
<Vault>/.obsidian/plugins/kos-companion/
  manifest.json
  main.js
  styles.css
  kos-agent/
```

不要在目标目录里再套一层 `kos-companion`。随后用 Obsidian 打开 Vault，并按上一节的第 3–5 步操作。

## 方式三：从源码一键安装

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

API key 写入 kos-agent 自身配置目录，不写入 Markdown 或 Obsidian `data.json`。不要把密钥放进 Vault、截图、Issue 或 Git。

未配置模型前，Agent 输入框会保持禁用。配置完成后首次启动卡会提供“运行系统检查”和“填写第一个工作流”两个入口，避免把连接成功误认为模型已经可用。

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
帮我开始今天的工作。读取当前 Goal、Project、Task Pool 和最近复盘，
根据我今天可用的时间给出最多三项建议；先让我确认，不要直接替我排期。
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

- 找不到 Node：确认 `node --version` 不低于 22.19；也可在 kos Companion 设置中填写 Node 可执行文件路径。
- 插件没有出现：确认目录层级中没有多套一层 `kos-companion/kos-companion`，然后重启 Obsidian。
- 仍显示旧界面：禁用再启用插件，并检查 `.obsidian/plugins/` 下是否残留同 ID 的备份插件。
- Agent 离线：先运行健康检查，再检查 Node 路径、provider、model ID 和 API key。
- Windows 没有 `make` 或 Python：一键安装器不依赖它们。

更完整的运行期排查见 `vault/90_系统/文档/90_故障排查.md`。
