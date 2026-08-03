# 火山引擎 Coding Plan 模型接入

日期：2026-07-31

## 来源与边界

接入依据为火山引擎方舟 Coding Plan 官方控制台文档：

- <https://console.volcengine.com/ark/region:cn-beijing/docs/82379/2188959?lang=zh>

Coding Plan 是订阅套餐网关，不等同于火山方舟普通按量推理 API。kos 使用其 OpenAI-compatible 接口：

```text
provider: volcengine-coding-plan
model ID: ark-code-latest
Base URL: https://ark.cn-beijing.volces.com/api/coding/v3
API: openai-completions
```

禁止将预设改成 `https://ark.cn-beijing.volces.com/api/v3`。后者是普通方舟推理地址，不使用 Coding Plan 套餐额度，并可能产生额外费用。

`ark-code-latest` 是服务端别名。控制台切换或平台升级后，响应中的实际模型可能变化，因此产品提示同时展示 requested model 和 `responseModel`，但不把当前路由结果固化为配置。

## 实现

- Obsidian 模型配置弹窗提供“火山 Coding Plan”预设，集中定义在 `ob-plugin/src/agent/model-presets.ts`。
- `configure_model` 继续只把 provider、model、协议和 Base URL 写入 `models.json`，API key 写入权限受限的本机 `auth.json`。
- 新 RPC `test_model` 通过当前 `ModelRuntime.completeSimple` 发起最小请求，设置 30 秒超时、零重试和有限输出 token。
- 连接测试不经过 Agent loop、不调用工具、不写入用户 Session。
- 返回数据只有 provider、requested model、可选 response model 和耗时，不返回测试正文、请求头或供应商响应体。
- 失败信息按认证、权限、模型/地址、限流、额度、超时和网络分类；无法识别的上游响应使用通用提示，避免错误体回显凭据。

## 真实验证

使用用户授权的 Coding Plan API key 在隔离临时配置目录完成了两层验证：

1. 专用 `/api/coding/v3/chat/completions` 网关返回 HTTP 200。
2. kos-agent 经 `configure_model → test_model` 返回成功，requested model 为 `ark-code-latest`，服务端当时实际路由为 `minimax-m2.7`，耗时约 2.8 秒。

API key 未写入仓库、Vault、测试 fixture、文档或终端输出；隔离配置和 Session 在测试后删除。实际路由模型和耗时只代表该次验证，不构成固定产品契约。

## 回归

- Agent 单测锁定脱敏错误分类。
- 插件单测锁定 Coding Plan 专用 Base URL、协议和模型别名，明确断言不能退回普通 `/api/v3`。
- RPC client 单测覆盖 `test_model` 命令与返回类型。
- 真实 Obsidian E2E 的假模型端点识别连接测试，验证“保存并测试”不会破坏首次启动和后续 Agent 工作流。
- 真实 provider 测试不进入默认 CI；只在拥有授权密钥的隔离环境执行。

## 安全后续

聊天、工单或屏幕共享中出现过的 API key 应视为已暴露。完成当前验收后应在火山引擎控制台轮换，并只把新 key 输入 kos Agent 配置弹窗。
