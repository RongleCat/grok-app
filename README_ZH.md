<p align="center">
  <img src="assets/logo.png" alt="Grok App Logo" width="128" height="128" />
</p>

<h1 align="center">Grok App</h1>

<p align="center"><strong>专为 Grok Build CLI 打造的现代化桌面工作台</strong></p>
<p align="center"><em>多项目管理 · 实时智能体流式会话 · 文件与代码闭环 · 全渠道远程 IM · 桌面伴侣与个性化</em></p>
<p align="center"><a href="https://grok-app.com">https://grok-app.com</a></p>

<p align="center">
  <a href="./README.md">English</a> ·
  <a href="./README_ZH.md">中文</a> ·
  <a href="./README_RU.md">Русский</a>
</p>

<p align="center">
  <a href="https://grok-app.com"><img src="https://img.shields.io/badge/website-grok--app.com-0ea5e9" alt="Website" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License" /></a>
  <a href="https://github.com/RongleCat/grok-app/stargazers"><img src="https://img.shields.io/github/stars/RongleCat/grok-app?style=social" alt="GitHub stars" /></a>
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey" alt="Platforms" />
  <img src="https://img.shields.io/badge/Tauri-2-orange" alt="Tauri 2" />
  <img src="https://img.shields.io/badge/note-unofficial-yellow" alt="Unofficial" />
</p>

<p align="center">
  <a href="https://x.com/cgnot996"><img src="https://img.shields.io/badge/X-铁柱AGI%20%40cgnot996-black?logo=x&logoColor=white" alt="X 铁柱AGI" /></a>
  <img src="https://img.shields.io/badge/微信公众号-铁柱AGI-07C160?logo=wechat&logoColor=white" alt="微信公众号 铁柱AGI" />
</p>

<p align="center">
  <img src="assets/wechat/mp-search-scan.png" alt="微信搜一搜 铁柱AGI · 扫码关注公众号" width="420" />
  &nbsp;&nbsp;
  <img src="assets/wechat/community-group-qr.png" alt="微信交流群二维码 · 扫码进群" width="200" />
</p>

---

> [!NOTE]
> **关于 Grok App：** 本项目是面向本机 [Grok Build](https://x.ai) CLI（`grok agent stdio`）的开源桌面客户端与工作台，**非 xAI 官方产品**。应用本身不打包专有模型权重，所有会话推理、工具调用与权限执行均基于你本地安装的 `grok` CLI。
>
> 完整智能体能力需要本地安装并登录 Grok Build CLI。首次启动时内置向导可一键协助安装；前端独立开发也可通过 `GROK_APP_ACP=mock` 进行联调。

---

## 目录

- [✨ 核心亮点](#-核心亮点)
- [🛠️ 功能全览](#️-功能全览)
- [📸 界面预览](#-界面预览)
- [🚀 快速开始与安装](#-快速开始与安装)
- [💡 平台说明与排查](#-平台说明与排查)
- [📂 配置与数据目录](#-配置与数据目录)
- [💻 源码构建与开发](#-源码构建与开发)
- [🤝 社区与贡献](#-社区与贡献)
- [👥 贡献者](#-贡献者)
- [📄 开源协议与作者](#-开源协议与作者)

---

## ✨ 核心亮点

- ⚡ **原生 Build 会话** — 通过 ACP 协议直接托管 `grok agent stdio`，支持 Ask（默认确认）、单次允许、本会话允许与 YOLO（完全自主）权限分级，默认启用 Grok 4.6 极高推理（`xhigh`）。
- 🗂️ **多项目工作台** — 独立项目空间、智能体看板、Git 工作树（Worktree）一键无缝切换、从任意助手回复分叉（Fork）会话、将历史对话作为上下文一键引用。
- 📝 **文件与创作闭环** — 内置 CodeMirror 代码与文本编辑器（支持实时保存与磁盘双向同步）、Git Diff 变更对比、图片/音视频/PDF/Office 丰富媒体预览，以及 Imagine 图像与视频生成。
- 📲 **全渠道远程 IM 连接** — 内置远程控制桥接，支持飞书 (Lark)、Telegram、Discord、Slack、钉钉、企业微信、微信个人、QQ、Matrix、LINE 与微博；支持手机 Web 镜像及本地 REST API。
- 🐾 **桌面伴侣与互动反馈** — 趣味置顶桌面宠物，实时感知智能体运行状态，提供灵动的交互反馈与气泡通知。
- 🔐 **本地隐私与自定中转** — API Key 安全托管至系统钥匙串；支持官方 SuperGrok 额度与热力图监控，支持自定义中转提供商（OpenRouter、DeepSeek、AI98PRO 等）并支持十五种界面语言。

---

## 🛠️ 功能全览

### 1. 现代化工作台与会话管理
- **项目与空间**：文件夹信任机制、项目空间隔离、虚拟化高性能会话列表、归档与跨项目会话迁移、一键导入 CLI 历史会话。
- **并行任务流**：多会话同时运行与后台持续流式输出，支持智能进程管理与闲置资源回收；直观看板分类（需要确认 / 正在执行 / 已完成）。
- **Git 深度集成**：自动识别项目绑定的 Git Worktrees，单会话一键切换工作目录，无缝应对多分支并行开发。
- **灵活分叉与引用**：支持从任意助手回复处建立新分支会话（自动对齐截断上下文），支持通过 `/attach-chat` 或拖拽会话直接作为参考上下文。

### 2. Agent 交互与实时时间线
- **结构化时间线**：思考过程、工具调用与最终回答按流式真实顺序展示，状态清晰，随时掌握 Agent 当前行为。
- **强大 Composer**：执行中支持追加后续消息队列；`Ctrl+Enter` 实时插话引导；支持打字自动聚焦、历史提示词回溯、代码选区批注引用。
- **精细权限控制**：默认 Ask 交互式审批；支持单次放行、当前会话信任、项目级默认策略与无人值守 YOLO 模式；支持工作区沙箱隔离。
- **任务与目标跟踪**：实时显示多步执行计划与目标进度（Plan / Goal），支持在资源面板查看详细步骤与 Markdown 报告。

### 3. 文件、媒体与创作中心
- **内置编辑器**：内置 CodeMirror 6，支持多标签页浏览与直接编辑保存代码/文本，Agent 生成修改后支持一键从磁盘重新载入。
- **变更与差异对比**：会话级修改与工作区 Git Diff 可视化审查，支持单文件/批量接受、拒绝与版本还原。
- **全格式媒体预览**：原生支持图片、视频、音频、PDF 以及 Word/Excel/PPT 等 Office 文档的高清预览与排版解析，支持一键导出精美分享长图。
- **AI 创作能力**：配合 Imagine 技能，直接在输入框生成高质量图片与视频；内置侧栏浏览器与设计模式，方便实时查看前端本地开发预览。

### 4. 扩展生态与自动化
- **斜杠指令与技能**：全面对齐 Grok Build 斜杠指令集，支持行内技能快速调用与自定义工作流 (`/workflow`)。
- **扩展与插件中心**：集成 MCP (Model Context Protocol) 服务管理，提供开放插件与技能生态（兼容 OpenAI 插件规范），所有扩展由用户自主管理。
- **ChatCut 插件集成**：内置推荐的 Codex 插件支持，统一管理授权刷新与浏览器协作。
- **定时与自动化**：支持可视化查看定时任务列表，可通过自然语言对话直接设定自动化执行任务。

### 5. 远程连接与多端协作
- **全渠道 IM 桥接**：支持绑定 11 大主流即时通讯平台，随时随地在手机群聊中唤醒并指挥本地 Agent（支持 `/p` 切换项目、`/r` 恢复会话）。
- **手机 Web 镜像**：基于令牌验证的轻量移动端 Web 界面，支持配合 Cloudflare Quick Tunnel 实现内网穿透安全访问。
- **本地会话 API**：提供标准 Loopback REST API (`GET /v1/sessions`、`POST /v1/sessions/{id}/turns`)，便于编写脚本或供第三方工具集成。

### 6. 账户、中转与个性化
- **多账号与用量追踪**：支持多账号快速切换，内置 SuperGrok 额度进度条与消耗热力图统计，自定义提供商用量本地记录。
- **中转提供商配置**：提供独立配置模式与共享模式（共享模式安全保护现有 `~/.grok` 配置）；内置 OpenRouter、DeepSeek、AI98PRO 等一键预设。
- **个性化视觉定制**：支持浅色/深色/跟随系统主题，支持自定义皮肤、壁纸（本地图片/Unsplash/Imagine）、界面与终端字体。
- **多语言支持**：原生内置 15 种语言（中、英、日、韩、德、法、俄、西、葡等），首次启动自动跟随操作系统语言。

---

## 📸 界面预览

| 🖥️ 工作台与会话视图 | 📊 账户与用量监控 |
|:---:|:---:|
| ![Workbench](assets/screenshots/workbench.png) | ![Account](assets/screenshots/account.png) |

| ☀️ 浅色主题模式 | 💬 媒体预览与交互 |
|:---:|:---:|
| ![Light](assets/screenshots/light.png) | ![Chat](assets/screenshots/chat.png) |

---

## 🚀 快速开始与安装

### 1. 下载预编译包

从官网 [grok-app.com](https://grok-app.com) 或 [GitHub Releases](https://github.com/RongleCat/grok-app/releases) 下载适合当前操作系统的安装包：

| 平台 | 安装包格式 | 说明 |
|:---|:---|:---|
| **macOS (Apple Silicon)** | `Grok_*_aarch64.dmg` | 适用于 M1/M2/M3/M4 系列 Mac |
| **macOS (Intel)** | `Grok_*_x64.dmg` | 适用于 Intel 处理器 Mac |
| **Windows (x64)** | `*-setup.exe` / `*-portable.zip` | 包含安装版与免安装绿色版 |
| **Linux (x64)** | `AppImage` / `.deb` / `.rpm` | 通用 AppImage，以及 Debian/Ubuntu/Fedora 格式 |

> 💡 **提示**：安装包名称为 **Grok**。预编译版本无需安装 Node.js、pnpm 或 Rust 等开发环境，开箱即用。

#### 校验安装包完整性
每个 Release 均提供 `SHA256SUMS` 文件，下载后可通过以下命令校验：
```bash
# macOS / Linux
shasum -a 256 -c SHA256SUMS --ignore-missing

# Windows (PowerShell)
Get-FileHash .\Grok_*_x64-setup.exe -Algorithm SHA256
```

---

### 2. 首次运行与准备

1. **启动与环境检查**：首次打开应用时，向导会自动检测本机是否已安装 Grok Build CLI（支持一键多源快速安装）。
2. **账号或中转配置**：支持登录官方账号、绑定 API Key 或配置第三方中转。若本地 CLI 已完成登录，可直接选择 **使用现有 CLI 登录**，无需重复授权。
3. **添加项目**：选择并信任本地工作目录。
4. **开始对话**：连接 Agent，选择 **Ask** 或 **YOLO** 模式，开始享受高效的桌面开发辅助！

#### 系统与依赖要求
- 本机已安装 **Grok Build CLI**（`grok`）**0.2.112 或更高版本**（可通过终端运行 `grok update` 进行更新）。
- Windows 环境需要 **WebView2 Runtime**（Windows 11 通常已内置；若缺失安装包会自动引导安装）。
- Linux AppImage：宿主需要 `libEGL.so.1` 以及 WebKitGTK 4.1 / Ayatana，见 [Linux 运行时库](#linux-运行时库appimage)。

#### 网络代理设置（网络受限环境）
若所处网络无法直连 Grok 官方服务（如部分地区）：
- 进入 **设置 → 运行环境 → 网络**，配置 HTTP/SOCKS 代理（例如 `http://127.0.0.1:7890`）。
- 点击 **测试连接** 确认 `auth.x.ai`、`grok.com` 等端点连通性。应用会自动将代理环境变量无缝注入到所有 Agent 子进程中。

---

## 💡 平台说明与排查

### macOS 提示「已损坏」或无法打开
官方 GitHub Releases 自 **v0.2.19** 起均已包含 Apple Developer ID 签名并完成 **Apple 官方公证 (Notarization)**。
若系统 Gatekeeper 仍出现拦截提示（如使用非官方编译版或隔离属性残留），可通过终端清除隔离标记：

```bash
xattr -cr /Applications/Grok.app
open /Applications/Grok.app
```
*或在 **系统设置 → 隐私与安全性** 中找到拦截项并点击 **仍要打开**。*

---

### Windows SmartScreen 提示未知发布者
在运行未签名的社区版本时，Windows SmartScreen 可能会弹出提示。点击 **更多信息 → 仍要运行** 即可。建议通过 `SHA256SUMS` 校验下载包的哈希值。

---

### Linux 运行时库（AppImage）

官方 AppImage **不会**打包宿主的 EGL / WebKit / 托盘库。在**干净的 Debian / Ubuntu** 上可能一启动就退出：

```text
error while loading shared libraries: libEGL.so.1: cannot open shared object file
```

先装运行时包（`.deb` 已依赖 WebKit；再补 EGL/GLES）。已在 **Debian 13（trixie）x86_64**、官方 `Grok_0.2.26_amd64.AppImage` 上确认：

```bash
sudo apt-get install -y libegl1 libgles2 libwebkit2gtk-4.1-0 libayatana-appindicator3-1
```

然后 `chmod +x` 再运行 AppImage（或解压后的 `usr/bin/grok-app`）。`.deb` 已声明 `libwebkit2gtk-4.1-0` 与 `libgtk-3-0`。

这是**进程启动时缺共享库**，不是下面 [Linux 渲染提示](#linux-渲染提示-webkitgtk) 的 Wayland / `EGL_BAD_PARAMETER` 情况。见 [#899](https://github.com/RongleCat/grok-app/issues/899)。

---

### Linux 渲染提示 (WebKitGTK)
如果进程根本起不来，报错是 `libEGL.so.1: cannot open shared object file`，那是缺宿主库——见 [Linux 运行时库](#linux-运行时库appimage)。

部分运行 Wayland（如 Hyprland + AMD 显卡）的 Linux 环境下，AppImage 可能会因容器打包版本与主机 Mesa 驱动兼容性问题出现显示异常：
- **推荐方案**：优先使用与系统包管理器契合的 **`.deb`** 或 **`.rpm`** 安装包（链接系统原生 WebKitGTK）。
- 如使用 AppImage，可尝试添加环境变量运行：
```bash
WEBKIT_DISABLE_DMABUF_RENDERER=1 ./Grok_*.AppImage
```

---

### Linux 工作区沙箱说明 (Ubuntu 24.04+)
Ubuntu 24.04+ 等现代发行版默认限制了非特权用户命名空间，可能导致 Agent 的 bubblewrap 沙箱无法启动：
- **方案一（推荐，保留系统级隔离）**：启用非特权用户命名空间
```bash
sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0
echo 'kernel.apparmor_restrict_unprivileged_userns=0' | sudo tee /etc/sysctl.d/99-userns.conf
```
- **方案二**：在 **设置 → 运行环境 → 沙箱** 中将沙箱模式切换为 **关闭 (off)**。

---

## 📂 配置与数据目录

默认数据根目录如下（可通过环境变量 **`GROK_APP_HOME`** 自定义覆盖）：

| 操作系统 | 默认存储路径 |
|:---|:---|
| **macOS** | `~/Library/Application Support/com.grokapp.grok-app/` |
| **Windows** | `%APPDATA%\grokapp\grok-app\` |
| **Linux** | `~/.grok-app/` |

目录结构一览：
```text
<app-data>/
  projects.json          # 项目空间索引
  sessions_index.json    # 会话元数据与索引
  settings.json          # 应用通用设置
  secrets.json           # 密钥元数据（优先存入系统钥匙串，本地 0600 加密回退）
  automations.json       # 定时自动化配置
  projects/              # 项目专属数据
  sessions/              # 历史会话持久化
  logs/                  # 运行诊断日志
  agent-home/            # 独立模式专属 GROK_HOME
```

---

## 💻 源码构建与开发

如果你希望参与开发或从源码构建 Grok App：

### 环境要求
- **Node.js**: `v22.0.0` 或更高版本
- **pnpm**: `v9.0.0` 或更高版本
- **Rust**: 稳定版 (Stable Toolchain)
- **C/C++ 构建工具**：macOS Xcode CLT / Windows MSVC / Linux build-essential & webkit2gtk

### 本地开发
```bash
# 1. 安装项目依赖
pnpm install

# 2. 启动桌面开发模式（包含 Tauri 与前端热更新）
pnpm dev

# 3. 仅启动 Web 前端（开发调试 UI）
pnpm dev:ui

# 4. 无 CLI 环境的 Mock 联调模式
GROK_APP_ACP=mock pnpm dev

# 5. 代码质量检查与单元测试
pnpm typecheck && pnpm test
cd src-tauri && cargo test

# 6. 本机打包构建
pnpm build
```

`pnpm dev` 会 merge `src-tauri/tauri.dev.conf.json`（`identifier` 为 `com.grokapp.desktop.dev`，产品名 **Grok Dev**），可与已安装的 **Grok** 并排运行。会话/设置仍共用同一套 App data，除非设置 `GROK_APP_HOME`。裸跑 `tauri dev`（不带 `--config`）会用正式版 identifier，抢走已安装实例。

Windows（可选）：双击 [`install-latest.cmd`](./install-latest.cmd) 会把 `main` fast-forward 到 `origin/main`，并静默安装一份未签名的并排 **grok-app-latest**（不覆盖正式版 **Grok**）。需要 VS Build Tools + Rust MSVC；详见 [docs/BUILD.md](./docs/BUILD.md)。

更多跨平台交叉编译与发版指南请参阅 [docs/BUILD.md](./docs/BUILD.md)。

---

## 🤝 社区与贡献

欢迎通过 Issue 反馈问题或提交 Pull Request！

| 文档指南 | 链接说明 |
|:---|:---|
| 📖 **Agent 与设计规范** | [`docs/llm-wiki/`](./docs/llm-wiki/) |
| 🛠️ **构建与发布指南** | [docs/BUILD.md](./docs/BUILD.md) |
| 📝 **版本更新日志** | [CHANGELOG.md](./CHANGELOG.md) |
| 💡 **贡献者指南** | [CONTRIBUTING.md](./CONTRIBUTING.md) |
| 🛡️ **行为准则** | [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) |
| 🔒 **安全披露策略** | [SECURITY.md](./SECURITY.md) |

---

## 👥 贡献者

<!-- CONTRIBUTORS:START -->
感谢所有为 Grok App 做出贡献的人！以下为 GitHub 仓库全部人类贡献者（按 commits 降序，2026-08-24 更新）。

<p align="center">
  <a href="https://github.com/RongleCat" title="RongleCat"><img src="https://github.com/RongleCat.png?size=96" width="72" height="72" alt="RongleCat" style="border-radius:50%" /></a>
  <a href="https://github.com/sonnemusk" title="sonnemusk"><img src="https://github.com/sonnemusk.png?size=96" width="72" height="72" alt="sonnemusk" style="border-radius:50%" /></a>
  <a href="https://github.com/zhangxaochen" title="zhangxaochen"><img src="https://github.com/zhangxaochen.png?size=96" width="72" height="72" alt="zhangxaochen" style="border-radius:50%" /></a>
  <a href="https://github.com/AlexZander85" title="AlexZander85"><img src="https://github.com/AlexZander85.png?size=96" width="72" height="72" alt="AlexZander85" style="border-radius:50%" /></a>
  <a href="https://github.com/Yy-702" title="Yy-702"><img src="https://github.com/Yy-702.png?size=96" width="72" height="72" alt="Yy-702" style="border-radius:50%" /></a>
  <a href="https://github.com/shiaho777" title="shiaho777"><img src="https://github.com/shiaho777.png?size=96" width="72" height="72" alt="shiaho777" style="border-radius:50%" /></a>
  <a href="https://github.com/Dmao233" title="Dmao233"><img src="https://github.com/Dmao233.png?size=96" width="72" height="72" alt="Dmao233" style="border-radius:50%" /></a>
  <a href="https://github.com/enderzcx" title="enderzcx"><img src="https://github.com/enderzcx.png?size=96" width="72" height="72" alt="enderzcx" style="border-radius:50%" /></a>
  <a href="https://github.com/ynjmxn" title="ynjmxn"><img src="https://github.com/ynjmxn.png?size=96" width="72" height="72" alt="ynjmxn" style="border-radius:50%" /></a>
  <a href="https://github.com/1llum1n4t1s" title="1llum1n4t1s"><img src="https://github.com/1llum1n4t1s.png?size=96" width="72" height="72" alt="1llum1n4t1s" style="border-radius:50%" /></a>
  <a href="https://github.com/erict16" title="erict16"><img src="https://github.com/erict16.png?size=96" width="72" height="72" alt="erict16" style="border-radius:50%" /></a>
  <a href="https://github.com/jason920612" title="jason920612"><img src="https://github.com/jason920612.png?size=96" width="72" height="72" alt="jason920612" style="border-radius:50%" /></a>
  <a href="https://github.com/oykb58246" title="oykb58246"><img src="https://github.com/oykb58246.png?size=96" width="72" height="72" alt="oykb58246" style="border-radius:50%" /></a>
  <a href="https://github.com/ChenYCL" title="ChenYCL"><img src="https://github.com/ChenYCL.png?size=96" width="72" height="72" alt="ChenYCL" style="border-radius:50%" /></a>
  <a href="https://github.com/1parado" title="1parado"><img src="https://github.com/1parado.png?size=96" width="72" height="72" alt="1parado" style="border-radius:50%" /></a>
  <a href="https://github.com/sutongwuyanzu" title="sutongwuyanzu"><img src="https://github.com/sutongwuyanzu.png?size=96" width="72" height="72" alt="sutongwuyanzu" style="border-radius:50%" /></a>
  <a href="https://github.com/a70win-wq" title="a70win-wq"><img src="https://github.com/a70win-wq.png?size=96" width="72" height="72" alt="a70win-wq" style="border-radius:50%" /></a>
  <a href="https://github.com/lunar-me" title="lunar-me"><img src="https://github.com/lunar-me.png?size=96" width="72" height="72" alt="lunar-me" style="border-radius:50%" /></a>
  <a href="https://github.com/falser101" title="falser101"><img src="https://github.com/falser101.png?size=96" width="72" height="72" alt="falser101" style="border-radius:50%" /></a>
  <a href="https://github.com/salasebas" title="salasebas"><img src="https://github.com/salasebas.png?size=96" width="72" height="72" alt="salasebas" style="border-radius:50%" /></a>
  <a href="https://github.com/Sdefendre" title="Sdefendre"><img src="https://github.com/Sdefendre.png?size=96" width="72" height="72" alt="Sdefendre" style="border-radius:50%" /></a>
  <a href="https://github.com/yuhaouno" title="yuhaouno"><img src="https://github.com/yuhaouno.png?size=96" width="72" height="72" alt="yuhaouno" style="border-radius:50%" /></a>
  <a href="https://github.com/2530185073" title="2530185073"><img src="https://github.com/2530185073.png?size=96" width="72" height="72" alt="2530185073" style="border-radius:50%" /></a>
  <a href="https://github.com/86208620" title="86208620"><img src="https://github.com/86208620.png?size=96" width="72" height="72" alt="86208620" style="border-radius:50%" /></a>
  <a href="https://github.com/apple-ouyang" title="apple-ouyang"><img src="https://github.com/apple-ouyang.png?size=96" width="72" height="72" alt="apple-ouyang" style="border-radius:50%" /></a>
  <a href="https://github.com/fannnzhang" title="fannnzhang"><img src="https://github.com/fannnzhang.png?size=96" width="72" height="72" alt="fannnzhang" style="border-radius:50%" /></a>
  <a href="https://github.com/hermes87666" title="hermes87666"><img src="https://github.com/hermes87666.png?size=96" width="72" height="72" alt="hermes87666" style="border-radius:50%" /></a>
  <a href="https://github.com/jchacker5" title="jchacker5"><img src="https://github.com/jchacker5.png?size=96" width="72" height="72" alt="jchacker5" style="border-radius:50%" /></a>
  <a href="https://github.com/KronixDev" title="KronixDev"><img src="https://github.com/KronixDev.png?size=96" width="72" height="72" alt="KronixDev" style="border-radius:50%" /></a>
  <a href="https://github.com/MaxxxDong" title="MaxxxDong"><img src="https://github.com/MaxxxDong.png?size=96" width="72" height="72" alt="MaxxxDong" style="border-radius:50%" /></a>
  <a href="https://github.com/praxstack" title="praxstack"><img src="https://github.com/praxstack.png?size=96" width="72" height="72" alt="praxstack" style="border-radius:50%" /></a>
  <a href="https://github.com/rkhrkh" title="rkhrkh"><img src="https://github.com/rkhrkh.png?size=96" width="72" height="72" alt="rkhrkh" style="border-radius:50%" /></a>
  <a href="https://github.com/Sixmin" title="Sixmin"><img src="https://github.com/Sixmin.png?size=96" width="72" height="72" alt="Sixmin" style="border-radius:50%" /></a>
  <a href="https://github.com/sk1935" title="sk1935"><img src="https://github.com/sk1935.png?size=96" width="72" height="72" alt="sk1935" style="border-radius:50%" /></a>
  <a href="https://github.com/tisrop" title="tisrop"><img src="https://github.com/tisrop.png?size=96" width="72" height="72" alt="tisrop" style="border-radius:50%" /></a>
  <a href="https://github.com/XancelZC" title="XancelZC"><img src="https://github.com/XancelZC.png?size=96" width="72" height="72" alt="XancelZC" style="border-radius:50%" /></a>
</p>

[完整贡献图 →](https://github.com/RongleCat/grok-app/graphs/contributors)
<!-- CONTRIBUTORS:END -->

---

## 📄 开源协议与作者

本项目采用 [MIT License](./LICENSE) 开源协议。

### 关注作者与社区

| 渠道 | 入口链接 |
|:---|:---|
| 𝕏 **X (Twitter)** | [@cgnot996 (铁柱AGI)](https://x.com/cgnot996) |
| 📢 **微信公众号** | 搜索 **「铁柱AGI」** 或扫描页顶左侧二维码 |
| 💬 **微信交流群** | 扫描页顶右侧二维码进群交流 |
| 🐧 **Linux.do 社区** | [linux.do](https://linux.do/) — 学 AI，上 L 站 |

🌟 **如果 Grok App 对你的日常开发有所帮助，请在 GitHub 上为我们点亮一颗 Star！**
