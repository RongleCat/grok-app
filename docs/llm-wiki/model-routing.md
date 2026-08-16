# 官方工具注入（仅自定义主模型）

## 原则

| 主路由 | 行为 |
|--------|------|
| **官方 Grok 订阅**（`active_source == official`） | **严禁** 注入 MCP `official-aux`、Host 识图预跑、侧信道 session rules。使用 Grok Build **默认原生** vision / `x_*` / `web_search`，避免双轨污染。 |
| **自定义 / 第三方**（DeepSeek、中转等） | 开关开启且官方凭证可用时，注入 **可调用** MCP `official-aux`；附图且主模型纯文本时 Host 识图预跑。通道勾了 **这个模型能看图**（或名称/模型 id 像 Grok / GPT-4o / Claude / Gemini）则主模型按多模态发像素，不剥 `@path`、不拦 `read_file` 读图。 |

X / web **不做 Host 关键词预跑**；由 agent 通过 tools 调用 `official-aux__x_*` / `web_search`。

## 产品入口

**设置 → 账户 → 拓展**：

| 控件 | 行为 |
|------|------|
| **注入官方工具能力** | `AppSettings.official_aux_inject`（默认 **开**，仅在 **custom 主路由** 可勾选） |
| **同时加载扩展 MCP** | `official_aux_with_user_mcp`（默认 **关**）；关时 session 只注入 `official-aux` |
| 官方 Grok 订阅主路由 | 注入开关 **置灰、显示为关**；不注入（原生 Imagine / X / vision） |
| 无官方凭证 | **置灰**不可用 |

深链：`#/settings/account/extras` · anchor `settings-anchor-official-aux-inject`。

## 官方侧信道（custom only）

主会话与官方能力**进程 + GROK_HOME 隔离**：

| 路径 | `GROK_HOME` | 用途 |
|------|-------------|------|
| ACP `agent stdio` + custom main | `agent-home`（无 auth.json） | 写码 / 主 tool loop |
| **Official aux** MCP / ACP | **`agent-home-official`** | 主模型经 MCP 调 `x_*` / `web_search` / `vision_describe`；识图 Host 预跑走 ACP |

**Host 预跑（仅 custom + 纯文本主模型）：**

| 时机 | 行为 | UI |
|------|------|-----|
| 附图 `@/path` | 剥离像素 → 官方 ACP 识图 → 文字注入主 prompt | 一条 tool 轨「识别图片内容」 |
| X / web | **不** Host 预跑；agent 调 MCP tools | 原生 tool 轨 |

**MCP `official-aux` 工具：**

| 工具名 | 侧信道 |
|--------|--------|
| `web_search` | 官方隔离凭证 |
| `x_keyword_search` | 同上（X/推特/x上 **首选**） |
| `x_semantic_search` | 同上 |
| `x_user_search` | 同上 |
| `x_thread_fetch` | 同上 |
| `vision_describe` | 同上（Host 已注入描述时勿再调） |
| `image_gen` | Imagine 文生图（画图 / 出图） |
| `image_edit` | Imagine 改图 / 修图（需本地参考路径） |
| `image_to_video` | 单图 → 短视频（图生视频） |
| `reference_to_video` | 多图参考 + 文案 → 视频 |

脚本：`scripts/official-aux-mcp.mjs`（工具 description 含中英别名，便于 `search_tool` 命中）。Host：`src-tauri/src/official_aux.rs`。

门闸实现：`should_inject_mcp_for_main()` = inject 开 ∧ 凭证可用 ∧ **`active_route() == Custom`**。

**Solo inject 与 Claude MCP：**  
默认 `official_aux_with_user_mcp=false` 时，spawn 设置 `GROK_CLAUDE_MCPS_ENABLED=false` / `GROK_CURSOR_MCPS_ENABLED=false`，避免把 `~/.claude.json` 里的 Playwright 等并进会话、拖慢 30s 才结束 connecting（官方-aux 本身约 10ms 即可就绪）。

**绝不**在 custom 主路由把官方 `auth.json` 写回主 `agent-home`。

**Imagine 凭证桥接（custom + inject）：**

1. **硬拦截原生 Imagine**（两道）：  
   - CLI `--disallowed-tools image_gen,image_edit,image_to_video,reference_to_video`（**仅 headless `grok -p` 生效**；ACP `agent stdio` 常忽略）。  
   - **PreToolUse hook**（可靠）：`{agent-home}/hooks/grok-app-block-native-imagine.json`，matcher 匹配上述工具并 `decision: deny`，reason 指引改走 `official-aux__*`。spawn / 开关变更时 `sync_native_media_block_hook`。  
2. 模型必须 `use_tool` → MCP `official-aux__image_*` / `image_to_video` / `reference_to_video`，侧信道 `GROK_HOME=agent-home-official`：  
   - 有 Settings 官方 API Key → 写入 `[model.grok-4.6] api_key`  
   - 仅 SuperGrok OIDC → 同步 `~/.grok/auth.json`，并 **去掉** 过期/错误 api_key，强制用订阅凭证  
3. **禁止** 在 API key 失败后改用 PIL/代码画图。  
4. **禁止** 对 `.png/.jpg/.webp…` 调用 `read_file` 做「验图」——纯文本主模型（DeepSeek 等）会因 tool result 里的 `image_url` 块 400 崩溃（`unknown variant image_url`）。Hook 同步拦截；成功后只回报绝对路径，UI 从路径挂附件。  
5. Host 从 MCP `rawOutput.output.OkayOutput` / markdown 反引号路径提取媒体路径 → `session://generated_image` / journal attachments。  
6. 官方订阅主路由：不 inject、不装 hook、不 disallowed 原生 Imagine（保持默认）。

## 开关与生效

- 改 `official_aux_inject` / `official_aux_with_user_mcp` → `settings_set` soft-respawn。  
- 改完后建议**重连会话**。  
- 切回官方订阅：自动不注入，无需手关（门闸看路由）。

## 相关

- 自定义提供商：`docs/llm-wiki/providers.md`  
- X 证据轨（产品）：`docs/features/x-search.md`  
