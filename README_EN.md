<p align="center">
  <img src="assets/logo.png" alt="Grok App Logo" width="128" height="128" />
</p>

<h1 align="center">Grok App</h1>

<p align="center"><strong>Modern Desktop Workbench for Local Grok Build CLI</strong></p>
<p align="center"><em>Multi-Project Spaces · Real-time Agent Streaming · Integrated File & Code Loop · Omnichannel Remote IM · Desktop Companion & Personalization</em></p>
<p align="center"><a href="https://grok-app.com">https://grok-app.com</a></p>

<p align="center">
  <a href="./README_EN.md">English</a> ·
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
  <img src="https://img.shields.io/badge/WeChat-铁柱AGI-07C160?logo=wechat&logoColor=white" alt="WeChat 铁柱AGI" />
</p>

<p align="center">
  <img src="assets/wechat/mp-search-scan.png" alt="WeChat Search 铁柱AGI — scan to follow" width="420" />
  &nbsp;&nbsp;
  <img src="assets/wechat/community-group-qr.png" alt="WeChat group QR — scan to join" width="200" />
</p>

---

> [!NOTE]
> **About Grok App:** Grok App is an open-source desktop client and workbench for the local [Grok Build](https://x.ai) CLI (`grok agent stdio`). It is **not an official xAI product**. The application does not bundle proprietary model backends; all chat reasoning, tool execution, and permissions run directly through your installed `grok` CLI.
>
> Full agent capabilities require an installed and signed-in Grok Build CLI. The first-run setup wizard can assist with CLI installation, and UI-only development can be run with `GROK_APP_ACP=mock`.

---

## Contents

- [✨ Key Highlights](#-key-highlights)
- [🛠️ Features Overview](#️-features-overview)
- [📸 Screenshots](#-screenshots)
- [🚀 Quick Start & Installation](#-quick-start--installation)
- [💡 Platform Notes & Troubleshooting](#-platform-notes--troubleshooting)
- [📂 Configuration & Data Paths](#-configuration--data-paths)
- [💻 Building from Source & Development](#-building-from-source--development)
- [🤝 Community & Contributing](#-community--contributing)
- [👥 Contributors](#-contributors)
- [📄 License & Author](#-license--author)

---

## ✨ Key Highlights

- ⚡ **Native Build Sessions** — Deep integration with `grok agent stdio` via the ACP protocol. Granular permission tiers (Ask, Allow Once, Allow for Session, and YOLO mode) with Grok 4.6 Extra High (`xhigh`) enabled by default.
- 🗂️ **Multi-Project Workbench** — Isolated project workspaces, agent status Kanban, one-click Git Worktree switching, session forking from any assistant reply, and cross-session context attachment.
- 📝 **Files & Creation Loop** — Embedded CodeMirror 6 editor with instant disk synchronization, visual Git Diff review, comprehensive media preview (images, video, audio, PDF, Office documents), and AI image/video generation via Imagine.
- 📲 **Omnichannel Remote IM** — Unified bridge connecting your local agent to Feishu/Lark, Telegram, Discord, Slack, DingTalk, WeCom, WeChat personal, QQ, Matrix, LINE, and Weibo; token-gated mobile web mirror and loopback REST session API.
- 🐾 **Desktop Companion & Status Feedback** — Interactive always-on-top desktop pet companion with live agent status awareness, responsive reactions, and notification bubbles.
- 🔐 **Privacy & Custom Relays** — API keys securely stored in your OS keychain. SuperGrok quota bar and heatmap tracking, custom provider relays (OpenRouter, DeepSeek, AI98PRO, etc.), and 15 built-in UI languages.

---

## 🛠️ Features Overview

### 1. Modern Workbench & Session Management
- **Projects & Workspaces**: Folder trust system, workspace isolation, virtualized high-performance sidebar, chat archiving, cross-project migration, and CLI session import.
- **Parallel Workflows**: Multi-session concurrent execution with continuous background streaming; intelligent process management and idle resource recycling; Kanban board (Needs Input / Working / Done).
- **Git Worktree Integration**: Automatically discovers linked Git worktrees for seamless working directory switching within sessions.
- **Session Forking & Attachment**: Branch off from any assistant turn with aligned context history; attach up to 3 reference sessions via `/attach-chat` or drag-and-drop.

### 2. Agent Interaction & Live Streaming
- **Structured Timeline**: Thought reasoning, tool executions, and final responses streamed in real-time order with live activity indicators.
- **Power Composer**: Queue follow-up prompts while the agent is busy; `Ctrl+Enter` to steer the active turn; type-to-focus; prompt history; selection quotes and inline annotations.
- **Granular Permissions**: Interactive Ask confirmation by default; allow once, allow for session, per-project defaults, or unattended YOLO mode; workspace sandbox support.
- **Plan & Goal Tracking**: Sticky multi-step plan progress with full Markdown execution details and structured milestones in the resources panel.

### 3. Files, Media & Creation Center
- **In-App Code & Text Editor**: CodeMirror 6 multi-tab editor with live two-way file synchronization and instant disk reload after agent modifications.
- **Visual Changes & Diffs**: Inspect session modifications and workspace Git diffs with granular single-file or batch accept/reject/revert controls.
- **Rich Media Viewer**: Native rendering and preview for images, video, audio, PDF, and Word/Excel/PowerPoint documents; high-quality share-card image export.
- **AI Asset Generation**: Generate images and videos directly from the composer using the Imagine skill; integrated side-browser with Design Mode for local web development previews.

### 4. Extensions, Plugins & Automations
- **Slash Commands & Skills**: Fully aligned with Grok Build slash command palette, inline skill chips, and custom automated workflows (`/workflow`).
- **Extensions Hub**: Manage Model Context Protocol (MCP) servers, plugins catalog (OpenAI plugin compatible), skills, agents, and hooks with full user control.
- **ChatCut Integration**: Native integration for the recommended Codex plugin with automated OAuth refresh and external editor workflows.
- **Scheduled Automations**: Schedule recurring or one-off tasks with natural-language prompt creation and visual execution logs.

### 5. Remote Connectivity & Cross-Device Access
- **11+ IM Channel Bridges**: Connect to your preferred messaging apps to monitor, resume, and steer your local desktop agent on the go (`/p` project switch, `/r` resume).
- **Mobile Web Mirror**: Lightweight token-gated web app for mobile browsers; compatible with Cloudflare Quick Tunnel for secure remote access.
- **Local Session API**: Loopback REST endpoints (`GET /v1/sessions`, `POST /v1/sessions/{id}/turns`) for scripting, CI, or third-party tool integrations.

### 6. Accounts, Relays & Personalization
- **Multi-Account & Quota Tracking**: Instant account switcher, official login, SuperGrok quota progress bar, cost heatmaps, and local tracking for custom providers.
- **Flexible Relay Modes**: Independent configuration mode or non-destructive shared mode (protects existing `~/.grok` configurations); one-click presets for OpenRouter, DeepSeek, AI98PRO, etc.
- **Visual Customization**: Light, dark, and system-adaptive themes; custom skins, wallpapers, UI fonts, terminal fonts, and share card styling.
- **Internationalization**: 15 built-in languages (EN, ZH, JA, KO, DE, FR, RU, ES, PT-BR, IT, ID, TA, UK, FIL, ZH-TW) with automatic OS locale detection.

---

## 📸 Screenshots

| 🖥️ Workbench & Sessions | 📊 Account & Quota Heatmap |
|:---:|:---:|
| ![Workbench](assets/screenshots/workbench.png) | ![Account](assets/screenshots/account.png) |

| ☀️ Light Theme Mode | 💬 Media Preview & Interaction |
|:---:|:---:|
| ![Light](assets/screenshots/light.png) | ![Chat](assets/screenshots/chat.png) |

---

## 🚀 Quick Start & Installation

### 1. Download Prebuilt Packages

Download installers directly from the official website [grok-app.com](https://grok-app.com) or [GitHub Releases](https://github.com/RongleCat/grok-app/releases):

| Platform | Package Format | Details |
|:---|:---|:---|
| **macOS (Apple Silicon)** | `Grok_*_aarch64.dmg` | Apple Silicon (M1/M2/M3/M4) Macs |
| **macOS (Intel)** | `Grok_*_x64.dmg` | Intel-based Macs |
| **Windows (x64)** | `*-setup.exe` / `*-portable.zip` | Setup installer and portable archive |
| **Linux (x64)** | `AppImage` / `.deb` / `.rpm` | Universal AppImage, Debian/Ubuntu, Fedora/RHEL |

> 💡 **Note**: The application bundle name is **Grok**. Prebuilt packages do not require Node.js, pnpm, or Rust installed on your system.

#### Checksum Verification
Each release includes a `SHA256SUMS` file. Verify your download with:
```bash
# macOS / Linux
shasum -a 256 -c SHA256SUMS --ignore-missing

# Windows (PowerShell)
Get-FileHash .\Grok_*_x64-setup.exe -Algorithm SHA256
```

---

### 2. First Run & Setup

1. **Launch**: Open Grok App. The setup wizard will automatically verify that the Grok Build CLI is installed (with multi-mirror fast install support).
2. **Account / Relays (Optional)**: Sign in with your official account, provide an API key, or configure a custom relay. If your local `grok` CLI is already authenticated, simply choose **Use existing CLI sign-in**.
3. **Add Project**: Select and trust your project working directory.
4. **Connect Agent**: Choose **Ask** or **YOLO** permission mode, and start building with your desktop agent!

#### Requirements
- Local **Grok Build CLI** (`grok`) **0.2.112 or newer** (run `grok update` in terminal to upgrade).
- Windows: Requires **WebView2 Runtime** (pre-installed on Windows 11; bootstrapped by the installer if missing).

#### Network & Proxy Configuration
In restricted network environments where Grok services cannot be reached directly:
- Navigate to **Settings → Runtime → Network** and configure your HTTP/SOCKS proxy (e.g., `http://127.0.0.1:7890`).
- Click **Test connection** to verify connectivity to endpoints (`auth.x.ai`, `grok.com`, etc.). The proxy is automatically injected into all agent processes.

---

## 💡 Platform Notes & Troubleshooting

### macOS Gatekeeper / "App is damaged"
Official releases starting from **v0.2.19** are signed with an Apple Developer ID and **Apple-notarized**.
If Gatekeeper blocks launching (e.g., on unsigned custom builds or due to quarantine metadata):

```bash
xattr -cr /Applications/Grok.app
open /Applications/Grok.app
```
*Or go to **System Settings → Privacy & Security** and click **Open Anyway**.*

---

### Windows SmartScreen Notice
For unsigned community packages, Windows SmartScreen may display a warning on initial launch. Click **More info → Run anyway**. You can verify the file hash against `SHA256SUMS` for integrity.

---

### Linux Display Notes (WebKitGTK / Wayland)
On certain Wayland desktop setups (such as Hyprland with AMD GPUs), the universal AppImage may encounter rendering conflicts with the host Mesa/DRI stack:
- **Recommended**: Use system-integrated **`.deb`** or **`.rpm`** packages which link against your distribution's native WebKitGTK.
- When running the AppImage, you can try disabling hardware compositing:
```bash
WEBKIT_DISABLE_DMABUF_RENDERER=1 ./Grok_*.AppImage
```

---

### Linux Workspace Sandbox (Ubuntu 24.04+)
Modern distributions such as Ubuntu 24.04+ restrict unprivileged user namespaces by default, which can prevent the bubblewrap agent sandbox from launching:
- **Option 1 (Recommended, preserves sandbox isolation)**: Enable unprivileged user namespaces
```bash
sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0
echo 'kernel.apparmor_restrict_unprivileged_userns=0' | sudo tee /etc/sysctl.d/99-userns.conf
```
- **Option 2**: In **Settings → Runtime → Sandbox**, switch the sandbox mode to **off**.

---

## 📂 Configuration & Data Paths

Default application data directory (override via the **`GROK_APP_HOME`** environment variable):

| Operating System | Default Path |
|:---|:---|
| **macOS** | `~/Library/Application Support/com.grokapp.grok-app/` |
| **Windows** | `%APPDATA%\grokapp\grok-app\` |
| **Linux** | `~/.grok-app/` |

Data layout:
```text
<app-data>/
  projects.json          # Project registry
  sessions_index.json    # Session metadata index
  settings.json          # Application preferences
  secrets.json           # Secure key metadata (OS keychain prioritized, 0600 fallback)
  automations.json       # Scheduled automations
  projects/              # Project-specific metadata
  sessions/              # Persistent session history
  logs/                  # Diagnostic logs
  agent-home/            # Independent mode GROK_HOME
```

---

## 💻 Building from Source & Development

To develop or build Grok App from source:

### Prerequisites
- **Node.js**: `v22.0.0` or newer
- **pnpm**: `v9.0.0` or newer
- **Rust**: Stable Toolchain
- **Platform Build Tools**: macOS Xcode CLT / Windows MSVC / Linux build-essential & webkit2gtk

### Development Workflow
```bash
# 1. Install dependencies
pnpm install

# 2. Start desktop development app (Tauri + Vite HMR)
pnpm dev

# 3. Start web frontend only (UI iteration)
pnpm dev:ui

# 4. Start with mock ACP backend (no CLI required)
GROK_APP_ACP=mock pnpm dev

# 5. Type checking and tests
pnpm typecheck && pnpm test
cd src-tauri && cargo test

# 6. Build production package
pnpm build
```

`pnpm dev` merges `src-tauri/tauri.dev.conf.json` (`identifier` `com.grokapp.desktop.dev`, product **Grok Dev**) so it can run beside installed **Grok**. Sessions still share App data unless `GROK_APP_HOME` is set. Bare `tauri dev` without `--config` uses the official identifier and will steal the installed instance.

Windows (optional): double-click [`install-latest.cmd`](./install-latest.cmd) to fast-forward `origin/main` and silently install an unsigned side-by-side **grok-app-latest** (does not replace official **Grok**). Needs VS Build Tools + Rust MSVC; details in [docs/BUILD.md](./docs/BUILD.md).

For cross-compilation and packaging instructions, see [docs/BUILD.md](./docs/BUILD.md).

---

## 🤝 Community & Contributing

Contributions, bug reports, and suggestions are warmly welcomed!

| Guide | Description |
|:---|:---|
| 📖 **Agent & Product Rules** | [`docs/llm-wiki/`](./docs/llm-wiki/) |
| 🛠️ **Build & Packaging Guide** | [docs/BUILD.md](./docs/BUILD.md) |
| 📝 **Changelog** | [CHANGELOG.md](./CHANGELOG.md) |
| 💡 **Contributing Guide** | [CONTRIBUTING.md](./CONTRIBUTING.md) |
| 🛡️ **Code of Conduct** | [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) |
| 🔒 **Security Policy** | [SECURITY.md](./SECURITY.md) |

---

## 👥 Contributors

<!-- CONTRIBUTORS:START -->
Thanks to everyone who has contributed to Grok App. All human GitHub contributors (by commit count, updated 2026-08-21).

<p align="center">
  <a href="https://github.com/RongleCat" title="RongleCat"><img src="https://github.com/RongleCat.png?size=96" width="72" height="72" alt="RongleCat" style="border-radius:50%" /></a>
  <a href="https://github.com/sonnemusk" title="sonnemusk"><img src="https://github.com/sonnemusk.png?size=96" width="72" height="72" alt="sonnemusk" style="border-radius:50%" /></a>
  <a href="https://github.com/AlexZander85" title="AlexZander85"><img src="https://github.com/AlexZander85.png?size=96" width="72" height="72" alt="AlexZander85" style="border-radius:50%" /></a>
  <a href="https://github.com/Yy-702" title="Yy-702"><img src="https://github.com/Yy-702.png?size=96" width="72" height="72" alt="Yy-702" style="border-radius:50%" /></a>
  <a href="https://github.com/shiaho777" title="shiaho777"><img src="https://github.com/shiaho777.png?size=96" width="72" height="72" alt="shiaho777" style="border-radius:50%" /></a>
  <a href="https://github.com/zhangxaochen" title="zhangxaochen"><img src="https://github.com/zhangxaochen.png?size=96" width="72" height="72" alt="zhangxaochen" style="border-radius:50%" /></a>
  <a href="https://github.com/enderzcx" title="enderzcx"><img src="https://github.com/enderzcx.png?size=96" width="72" height="72" alt="enderzcx" style="border-radius:50%" /></a>
  <a href="https://github.com/1llum1n4t1s" title="1llum1n4t1s"><img src="https://github.com/1llum1n4t1s.png?size=96" width="72" height="72" alt="1llum1n4t1s" style="border-radius:50%" /></a>
  <a href="https://github.com/jason920612" title="jason920612"><img src="https://github.com/jason920612.png?size=96" width="72" height="72" alt="jason920612" style="border-radius:50%" /></a>
  <a href="https://github.com/oykb58246" title="oykb58246"><img src="https://github.com/oykb58246.png?size=96" width="72" height="72" alt="oykb58246" style="border-radius:50%" /></a>
  <a href="https://github.com/ynjmxn" title="ynjmxn"><img src="https://github.com/ynjmxn.png?size=96" width="72" height="72" alt="ynjmxn" style="border-radius:50%" /></a>
  <a href="https://github.com/ChenYCL" title="ChenYCL"><img src="https://github.com/ChenYCL.png?size=96" width="72" height="72" alt="ChenYCL" style="border-radius:50%" /></a>
  <a href="https://github.com/erict16" title="erict16"><img src="https://github.com/erict16.png?size=96" width="72" height="72" alt="erict16" style="border-radius:50%" /></a>
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
  <a href="https://github.com/Dmao233" title="Dmao233"><img src="https://github.com/Dmao233.png?size=96" width="72" height="72" alt="Dmao233" style="border-radius:50%" /></a>
  <a href="https://github.com/fannnzhang" title="fannnzhang"><img src="https://github.com/fannnzhang.png?size=96" width="72" height="72" alt="fannnzhang" style="border-radius:50%" /></a>
  <a href="https://github.com/hermes87666" title="hermes87666"><img src="https://github.com/hermes87666.png?size=96" width="72" height="72" alt="hermes87666" style="border-radius:50%" /></a>
  <a href="https://github.com/jchacker5" title="jchacker5"><img src="https://github.com/jchacker5.png?size=96" width="72" height="72" alt="jchacker5" style="border-radius:50%" /></a>
  <a href="https://github.com/MaxxxDong" title="MaxxxDong"><img src="https://github.com/MaxxxDong.png?size=96" width="72" height="72" alt="MaxxxDong" style="border-radius:50%" /></a>
  <a href="https://github.com/rkhrkh" title="rkhrkh"><img src="https://github.com/rkhrkh.png?size=96" width="72" height="72" alt="rkhrkh" style="border-radius:50%" /></a>
  <a href="https://github.com/Sixmin" title="Sixmin"><img src="https://github.com/Sixmin.png?size=96" width="72" height="72" alt="Sixmin" style="border-radius:50%" /></a>
  <a href="https://github.com/sk1935" title="sk1935"><img src="https://github.com/sk1935.png?size=96" width="72" height="72" alt="sk1935" style="border-radius:50%" /></a>
  <a href="https://github.com/tisrop" title="tisrop"><img src="https://github.com/tisrop.png?size=96" width="72" height="72" alt="tisrop" style="border-radius:50%" /></a>
  <a href="https://github.com/XancelZC" title="XancelZC"><img src="https://github.com/XancelZC.png?size=96" width="72" height="72" alt="XancelZC" style="border-radius:50%" /></a>
</p>

[Full contributors graph →](https://github.com/RongleCat/grok-app/graphs/contributors)
<!-- CONTRIBUTORS:END -->

---

## 📄 License & Author

This project is licensed under the [MIT License](./LICENSE).

### Connect with the Author & Community

| Channel | Link |
|:---|:---|
| 𝕏 **X (Twitter)** | [@cgnot996 (铁柱AGI)](https://x.com/cgnot996) |
| 📢 **WeChat Official Account** | Search **「铁柱AGI」** or scan top-left QR |
| 💬 **WeChat Community** | Scan top-right QR code |
| 🐧 **Linux.do Community** | [linux.do](https://linux.do/) — Learn AI on L-Station |

⭐ **If Grok App empowers your daily workflow, please consider starring the repository!**
