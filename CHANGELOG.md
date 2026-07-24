# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

**Maintainer rule (AI):** before every `vX.Y.Z` tag, complete `## [X.Y.Z]` below.  
CI Release body = this section + install notes from `scripts/changelog-for-release.py`.  
See `docs/llm-wiki/release.md`.

## [Unreleased]

### Added

- Composer **context usage chip** (L09): shows known tokens after compact, or an honest `~` estimate / `—` when unknown; click for last compact summary + Compact action.
- Composer **file picker** (+ menu → Files / Folder) and **clipboard paste** for images/files (screenshot → temp path → `@path` attach).
- Open-source **maintenance playbook** (`docs/llm-wiki/maintain.md`): triage labels, PR review, community intake, ship loop.
- **Single-instance** plugin: second launch focuses the existing window (macOS Dock multi-open).
- Thinking/reasoning **auto-collapse when done** (default); remembers last expand/collapse choice.
- Error codes **QUOTA_EXCEEDED** / **CONNECT_FAILED** with clearer user-facing copy.
- **Multi-account switcher**: save / switch / remove official Grok auth snapshots (Settings → Account).
- **Import conversation** from markdown/JSON file into a local session (web-history alternative).
- **Linux x64** packaging path: `pnpm build:linux`, CI rust job + release matrix `ubuntu-22.04` (AppImage/deb).
- **Traditional Chinese (zh-TW)** UI locale — community PR #18.
- **ACP API mode**: optional TCP connection to a remote ACP server (`host:port`) instead of local CLI spawn — community PR #20.

### Fixed

- **Settings → Session data mode**: switching to shared used `window.confirm`, which is unreliable in Tauri WebView and made the control look broken — use in-app confirm (Fixes #19).
- **Add project trust prompt**: also replaced `window.confirm` with in-app dialog (same Tauri WebView issue).
- **Plan card**: keep `exit_plan_mode` `rpcId` when later `sessionUpdate` plan notifications arrive without one, so Approve / Request changes stay clickable (Fixes #17).
- **Plan mode**: handle `_x.ai/exit_plan_mode` (planContent body + Approve/Revise/Abandon RPC reply); wire Plan card buttons (minos-aligned).
- **Thinking UI**: multi-phase reasoning split into separate blocks (pre-tool vs post-tool); thought chunks bind to current assistant message id.
- **Session ↔ project rebind**: composer project chip is a menu — bind orphan /「未选项目」sessions to a trusted folder (or clear back to orphan).
- Grok Build shell permission fallbacks use **underscore** optionIds (`allow_once` / `reject`) — community PR #2.
- Session auto-title LLM prompt follows **app locale** (EN/ZH) — community PR #1.
- Composer stays **draftable while streaming** so a paused stream no longer feels like a hard lock.
- macOS titlebar: larger traffic-light safe inset; panel toggle stays non-drag and icon-visible.
- **Same-session history duplication**: stream chunks only bind to the current turn; clear stuck streaming flags on send/turn end; journal upsert by message id; stronger history-bootstrap anti-echo prompt.
- Login failure when xAI returns Access denied / auth-code generation failure — actionable message (network / device code / custom provider).
- Friendlier mapping for “Could not connect the agent” and quota/rate-limit phrases.

### Community

- Issues #3–#13 opened from launch-thread X feedback (duplicate history, login auth, attach, multi-open, Linux, etc.).
- PR #18 (zh-TW), PR #20 (ACP TCP API mode) merged; issues #17 / #19 fixed on main.

## [0.1.0] - 2026-07-24

> 中英文对照 / Bilingual notes. English first (Keep a Changelog), then 中文摘要 under each section.
>
> **Highlight:** first public release — Grok Build desktop workbench, open-source packaging for macOS ARM / Intel + Windows.

### Added

- **Desktop workbench** for Grok Build (`grok agent stdio` ACP): projects, multi-session sidebar, streaming chat, live tool activity line, permission bar (Ask / allow once / session / YOLO).
- **First-run setup wizard**: multi-mirror CLI install, optional official account / API key / custom relay; CLI is a hard gate, account is skippable.
- **Account UI**: login surface, SuperGrok quota + usage heatmap, membership-oriented status.
- **Custom providers**: independent agent home (`GROK_HOME` / `agent-home`) so relays do not have to pollute `~/.grok`.
- **Rich media & files**: image / video / PDF / Office / code previews; path cards with smart open (ellipsis / sibling KB paths); resource pane + embedded multi-webview browser.
- **Automations (“已安排”)**: task list + silent create-from-chat (`grok-automation` fence stripped from bubbles); shell polling without blocking the main conversation.
- **i18n**: EN / 中文 UI via `src/i18n/`; tray menu follows locale.
- **In-app glass dialogs**: product UX never uses `window.confirm` / `prompt` / `alert`.
- **Packaging & open source**
  - GitHub Actions release matrix: macOS ARM64, macOS Intel, Windows x64.
  - Local cross-build: `cargo-xwin` + NSIS on macOS (`pnpm build:win`).
  - CHANGELOG-driven Release body (`scripts/changelog-for-release.py`) including macOS Gatekeeper / “damaged app” steps.
  - MIT license, bilingual README, CONTRIBUTING / SECURITY / CoC, issue & PR templates.

### Fixed

- Chat image cards: synchronous path resolve + cache to avoid zero-height flash / scroll jump while browsing history.
- Path open: strip agent `.../` ellipsis truncation; resolve files under project sibling folders (shared knowledge-base layout).
- Tauri feature allowlist: keep `macos-private-api` aligned for Windows cross-builds via cargo-xwin.
- Automation connect failures: do not leave empty “ghost” sessions in the sidebar.

### Changed

- Session continuity UX: single plain-text running tool line (not multi-row tool stack).
- Release process documented for AI maintainers: `docs/llm-wiki/release.md` + `docs/BUILD.md`.

### Notes

- **Not an official xAI product.** Real agents need a working [Grok Build](https://x.ai) CLI on the machine.
- macOS downloads are **unsigned / not notarized** — use `xattr -cr /Applications/Grok.app` if Gatekeeper blocks (see Release install notes).

**中文 · 新增**

- **Grok Build 桌面指挥台**：项目 / 多会话 / 流式对话 / 工具活动行 / 权限条（Ask · YOLO）。
- **首次向导**：CLI 多镜像安装（硬门禁）；账号 / Key / 中转可跳过。
- **账号与额度**、自定义中转（独立 `GROK_HOME`）、富媒体与资源预览、已安排自动化（对话静默创建，气泡不露 JSON）。
- **中英 UI + 托盘**、应用内毛玻璃弹窗（禁用系统 confirm/prompt/alert）。
- **开源与打包**：Actions 三端；本机 cargo-xwin 打 Windows；CHANGELOG 驱动 Release（含 macOS「已损坏」处理）；MIT 与双语 README。

**中文 · 修复**

- 聊天图片同步解析防滚动跳动；路径省略号 / 旁路知识库打开；Windows 交叉编译 private-api 白名单；自动化连接失败不留空壳会话。

**中文 · 变更**

- 工具活动改为单行纯文本；发版流程写入 `docs/llm-wiki/release.md` 供后续 AI 接手。

**中文 · 说明**

- **非 xAI 官方**；真 Agent 需本机 Grok Build CLI。macOS 未公证，遇 Gatekeeper 用 `xattr -cr`。
