# Spec — MCP 厂商标识

## Problem Statement

设置 → 扩展 → MCP 里每个服务器都显示同一个插头图标，"context7"、"linear"、"github" 看起来
完全一样。用户装了多个 MCP 服务器后，只能逐个读名字才能分辨，扫视列表时找不到目标。

## Solution

MCP 列表里每个远程服务器显示它所属厂商的方形标识，来源是厂商自己的站点：

- 从 MCP Target 的主机名剥出**注册域**（`mcp.context7.com` → `context7.com`），解析站点声明的
  图标，取不到再试 `/favicon.ico`。
- 图标由宿主下载、校验、转成统一尺寸并缓存；设置页只负责展示。
- 没有 URL（本地 `stdio`）或取不到图标时，显示**字母徽标**。
- 不调用任何第三方图标服务。

## User Stories

1. As a Grok App user, I want each MCP server row in Settings → Extensions to show its vendor's icon, so that I can tell servers apart at a glance.
2. As a user with several MCP servers configured, I want to find "context7" without reading every name, so that switching servers is faster.
3. As a user behind a slow or offline network, I want previously resolved icons to still render, so that the settings list does not flicker or degrade.
4. As a user with a local stdio MCP server, I want a stable fallback mark instead of a broken image, so that the row still looks finished.
5. As a privacy-conscious user, I want icon lookups to contact only the vendor's own domain, so that my MCP configuration is not shared with third parties.
6. As a user with a vendor that publishes no usable icon, I want a deterministic letter mark, so that the same server always looks the same.
7. As a user on a dark theme, I want the icon to sit on the existing row tile without clashing, so that the list keeps its visual rhythm.
8. As a user who switches MCP servers often, I want icons to appear without blocking the list, so that toggles and controls stay responsive.
9. As a user whose vendor changed its logo, I want the icon to refresh eventually without manual work, so that the list stays current.
10. As a user with a misconfigured MCP Target, I want the row to fall back gracefully, so that one bad URL does not break the tab.
11. As a user who opens Settings repeatedly, I want repeat opens to be instant, so that navigation does not wait on the network.
12. As a user with an MCP server added minutes ago, I want its icon to resolve on the next settings refresh, so that new servers are covered.
13. As a keyboard/screen-reader user, I want the decorative icon hidden from assistive tech and the server name still authoritative, so that navigation stays unambiguous.
14. As a user with many servers, I want icon lookups to be bounded in concurrency, so that opening Settings does not fire a burst of requests.
15. As a user who disables a server, I want the icon to stay recognizable, so that I can re-enable the right one.
16. As a user with duplicate vendor servers on different hosts, I want consistent icons, so that grouping is obvious.
17. As a user with a self-hosted MCP server on a private network, I want the app to refuse fetching internal addresses, so that no local service is probed.
18. As a user with an SVG-only site icon, I want it to render correctly, so that modern vendors are not shown as letters.
19. As a user who removes a server, I want its cached icon not to leak into another row, so that icons always match names.
20. As a developer maintaining the list, I want icon resolution isolated from row rendering, so that the row logic stays simple.
21. As a user on the first launch after upgrading, I want icons to fill in progressively, so that the MCP tab is usable immediately.
22. As a user with a slow vendor domain, I want a hard timeout, so that the row does not hang waiting for an icon.
23. As a user who renamed a server, I want the icon to follow its Target rather than its name, so that renaming does not reset the icon.

## Implementation Decisions

- **解析归属**：图标解析放在宿主（Rust），前端只消费结果。理由：需要注册域解析、HTML
  解析、图片解码与落盘缓存，且必须复用既有的安全 HTTPS 客户端来防 SSRF。
- **注册域**：引入 `psl` crate（Mozilla Public Suffix List），求注册域，避免把
  `foo.github.io` 误判成 `github.io`。
- **候选顺序**：MCP 服务器 `initialize` 回复里的 `serverInfo.icons`（带配置鉴权头，
  厂商自报，优先级最高）→ 注册域根文档的 `<link rel="icon">` / `<link rel="apple-touch-icon">`
  （按声明尺寸与格式优选）→ 注册域 `/favicon.ico` → 原始主机 `/favicon.ico`。
- **安全边界**：只接受 `https`；拒绝带 userinfo 的 URL；DNS 解析结果必须为公网地址；
  单次响应体上限 512 KiB、总超时 8 秒；错误信息不回传原始 Target（可能含密钥）。
- **输出格式**：位图缩到最长边 ≤64 px 的 PNG（只缩不放，保留透明通道）；SVG 原样保留并限制体积；以
  `data:image/...;base64,` 返回，前端 `<img>` 直接渲染。CSP 已允许 `data:`。
- **缓存**：App 数据目录 `cache/mcp-icons/`，按「注册域 + 服务器名」哈希命名；成功 30 天、失败 7 天；
  过期后重新解析，失败则继续用旧值。缓存条目只存域名与图标，不存 Target 原文。
- **接口**：宿主命令 `mcp_icon_resolve(target, serverName)` 返回
  `{ dataUrl, domain, source: "site" | "favicon" | "none", fromCache }`；
  前端遇到 `none` 或命令失败时渲染字母徽标。
- **前端边界**：新增纯函数模块承载「Target → 可解析 URL」「字母与配色」「请求去重缓存」，
  新增一个只负责展示的图标组件；MCP 行只替换图标节点。
- **并发**：前端按主机去重，同一主机只发一次请求；同时最多 4 个在途请求。
- **范围**：本期只改设置 → 扩展 → MCP 列表行；MCP 状态弹窗、Doctor 报告、插件卡片不在范围内。
- **不新增用户可见文案**：图标是装饰性元素，`alt=""` + `aria-hidden`，服务器名仍是唯一可读标签。

## Testing Decisions

好的测试只验证外部行为：给定 Target / 服务器名，返回什么图标数据或徽标；给定缓存文件与
时间，是否命中。测试不 mock 内部私有函数。

- **宿主**：注册域计算（含多段后缀）、候选 URL 选取与优先级、缓存新鲜度、图标解码与
  data URL 生成、私网/非 https Target 被拒绝。与 `wallpaper_web_page.rs`、
  `image_thumb.rs` 的现有单测同风格。
- **前端纯函数**：Target 提取、字母徽标（首字母、确定性配色）、去重缓存命中。
- **组件**：用 `@testing-library/react` 断言三种状态——有图标时渲染 `<img>`；`none` 或命令
  抛错时渲染字母；加载中不出现空框。命令通过 `vi.mock` 的 API 模块注入。
- **回归**：`pnpm typecheck`、`pnpm lint`、`pnpm test`、`cd src-tauri && cargo test`。

## Out of Scope

- 其他界面（MCP 状态弹窗、Doctor 报告、插件市场卡片）的图标。
- `stdio` 服务器的 `serverInfo.icons`：设置页不为图标启动子进程。
- 随包内置品牌图标表。
- 用户自定义上传图标。
- 第三方图标服务（Google S2 / DuckDuckGo）。

## Further Notes

- 远程 MCP 的 Target 可能是 OAuth 回调地址或带查询参数；缓存键与请求都只用注册域和服务器名，
  避免把查询参数写进磁盘。
- 图标只是识别辅助；用户重命名服务器不会改变图标来源（来源是 Target）。
- 失败结果也缓存，避免每次打开设置都重复请求 404 的厂商。
