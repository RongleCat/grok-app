# MCP 厂商标识

设置 → 扩展 → MCP 的每一行显示服务器所属厂商的图标。**不是**第三方图标服务，也**不是**
随包内置的品牌表。

Related: [media-delivery.md](./media-delivery.md)（本地/远程图片展示）、
[settings-ia.md](./settings-ia.md)（扩展页结构）、ADR `docs/adr/0006-mcp-icons-from-vendor-registrable-domain.md`。

## 数据流

| 层 | 职责 |
|----|------|
| Target → 注册域 | 宿主从 MCP Target 取主机名，用 `psl` 求注册域（`mcp.context7.com` → `context7.com`） |
| 首选来源 | 对**已启用**的 https Target 发一次 `initialize`（鉴权头仅在 Target 与配置 URL 一致时附带），读 `result.serverInfo.icons` |
| 站内发现 | 服务器没声明图标时，读注册域根文档的 `<link rel="icon">` / `apple-touch-icon`（SVG 优先、再按尺寸），再回落 `/favicon.ico`，最后试原始主机 |
| 交付 | 位图缩到最长边 ≤64 px 的 PNG（只缩不放）、SVG 原样保留，编码成 `data:image/...;base64,` 返回前端 |
| 展示 | `McpServerIcon` 异步替换字母徽标；拿不到图标时保留字母徽标 |
| 缓存 | `{app data}/cache/mcp-icons/{domain + server hash}.json`；成功 30 天、失败 7 天 |

## 硬规则

- **除 `initialize` 外，只访问厂商自己的注册域（含子域）**。站点把图标放在第三方 CDN 时宁可
  回落到 `/favicon.ico`；服务器自报的图标 URL 同样必须在注册域内。不要接 Google S2、
  DuckDuckGo icons 或任何图标聚合服务，那会把用户配置了哪些厂商外泄，并且离线失效。
- **`initialize` 只发给已启用服务器**，4 秒超时，结果按 30 天缓存；打开 MCP 设置会对每个
  未缓存的已启用 https 服务器各握手一次，没有单独开关。鉴权头只在 Target 与该服务器配置的
  URL 完全一致（协议/主机/端口/路径）时附带，防止 IPC 调用方借服务器名把凭据送到别的主机。
  该请求的目标就是服务器自己的 Target（含查询串），不是第三方。
- 只接受 `https`；拒绝 userinfo 与私网 DNS 解析；单次响应 ≤ 512 KiB、总超时 8 秒。
  下载与跳转必须走 `skin_net` 的安全客户端，不要新建裸 `reqwest` 客户端。
- `post_json` 不跟随重定向：3xx 直接判为阻断，避免把 `Authorization` 重发到未校验的主机。
- 前端只接受 `data:image/png;base64,` 与 `data:image/svg+xml;base64,`；宿主把其他内联位图
  重编码成 PNG。
- 缓存键只用注册域 + 服务器名。**磁盘上不得出现 Target 原文或查询参数**（远程 MCP 的 URL 可能带密钥）。
- 图标是装饰元素：`alt=""` + `aria-hidden`，服务器名仍是唯一可读标签；不新增可见文案。
- 本地 `stdio` 服务器没有 URL，设置页不会为了图标启动进程，直接显示字母徽标
  （首字母 + 名称哈希配色）。禁用行同理：只展示已有缓存或字母徽标，不发起请求。
- 宿主命令不可用（浏览器预览、镜像客户端）时静默回落，不弹错误。

## 范围

本期只覆盖设置 → 扩展 → MCP 列表行。MCP 状态弹窗、Doctor 报告、插件市场卡片仍用各自的
图标逻辑。

## 后续可加

- 把 `serverInfo.icons` 的 `sizes`/`mimeType` 纳入选择（当前按声明顺序取第一个可用图标）。
- 服务器声明 `websiteUrl` 但图标在别的域名时，可用它校正注册域。
