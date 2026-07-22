# 微信公众号文章抓取参考

## 问题

`mp.weixin.qq.com` 文章 URL 在浏览器中常触发 POC Token + 验证码（`wappoc_appmsgcaptcha`），导致无法直接抓取正文。

## 已验证的元信息提取方法

使用 curl + 桌面浏览器 User-Agent，从页面 JavaScript 变量中提取：

```bash
curl -sL \
  -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36" \
  -H "Accept: text/html,application/xhtml+xml" \
  "URL" | grep -i 'var msg_title\|var nickname\|var ct'
```

可提取的字段：
- `msg_title`：文章标题
- `nickname`：公众号名称（作者）
- `ct`：发布时间戳（Unix epoch，秒级）
- `msg_link`：文章链接
- `msg_desc`：文章摘要/描述（常为空白）

时间戳转换：
```bash
date -r 1776990600 "+%Y-%m-%d"   # macOS
# Linux: date -d @1776990600 "+%Y-%m-%d"
```

## 处理策略

1. 提取元信息后创建 Source 文件，状态设为 `captured`。
2. 在正文中注明："微信公众号存在访问限制，正文尚未抓取。"
3. 列出待处理事项：补充正文、摘录、摘要、关联项目。
4. 建议用户在微信内打开链接后复制全文粘贴到 Source 文件。
5. 不要因抓取失败而跳过登记。

## 注意事项

- 不要使用 `browser_navigate` 直接访问，会被重定向到验证码页。
- 不要使用 `grep -P`，macOS 默认 grep 不支持 Perl 正则。
- `poc_token` 参数会过期，不要依赖它。