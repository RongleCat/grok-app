# 发版与 Release 维护（AI 必读）

> 任何 Agent 接手发版时**只读本文件 + `docs/BUILD.md` + `CHANGELOG.md`**，不要靠会话记忆。

## 目标

- 每次正式版 = **一个 git tag `vX.Y.Z`** + **GitHub Release** + **多平台安装包**  
  - macOS Apple Silicon (`aarch64` `.dmg`)  
  - macOS Intel (`x64` `.dmg`)  
  - Windows x64 安装版 (`*-setup.exe`) + **绿色版** (`*-portable.zip`)  
  - Linux x64：**AppImage** + **.deb**（Debian/Ubuntu 系）+ **.rpm**（Fedora/RHEL 系）
- Release 正文**只保留本版变更**（`CHANGELOG.md` 对应 `## [X.Y.Z]` 章节）。  
  下载资产由 GitHub 自动挂在下方；安装 / Gatekeeper / SmartScreen / CLI 说明见 README，**不要**在每个 Release 重复长文。

正文由 CI 调用 `scripts/changelog-for-release.py` 自动生成，**禁止**在 workflow 里写死静态 Release body 覆盖 CHANGELOG。

## 版本号三处同步

| 文件 | 字段 |
|------|------|
| `package.json` | `version` |
| `src-tauri/tauri.conf.json` | `version` |
| `src-tauri/Cargo.toml` | `[package].version` |

Settings → About 的 `app.versionFooter` 用 `{version}`，构建时注入：HEAD 恰好是 `vX.Y.Z` tag（或 CI `GITHUB_REF` 指向该 tag）则显示该 tag，否则显示 short commit hash。不要把 hash 写进 `tauri.conf.json` version（NSIS / updater 仍要 semver）。

`scripts/release-tag.sh` 会改以上三处清单。Tag 格式：`v0.1.0`（`v` + semver）。

## CHANGELOG 写法（强制）

文件：`CHANGELOG.md`（[Keep a Changelog](https://keepachangelog.com/) + SemVer）。

应用内 **What's New 弹窗**（`WhatsNewModal`）从该文件解析当前版本的 Added / Changed / Fixed，**每条只展示第一句**（`src/lib/whatsNew.ts` → `changelogPopupItem`）。GitHub Release 正文仍用整段章节（含第二句补充）。

每个正式版在 tag **之前**必须有：

```markdown
## [X.Y.Z] - YYYY-MM-DD

> 中英文对照。English first，再写 **中文 · …** 摘要。
>
> **Highlight:** 一句话亮点。
>
> **中文 · 亮点：** 一句话亮点。

### Added
- User-facing first sentence. Optional extra clause for GitHub.

### Changed
- …

### Fixed
- …

**中文 · 新增**
- 用户能看懂的第一句。可选一句补充。

**中文 · 变更**
- …

**中文 · 修复**
- …
```

### 弹窗 vs CHANGELOG（强制，从本规则落地后的版本起）

弹窗是用户能看到的更新日志，必须短。CHANGELOG 可以稍细，但也不要长篇。

| 表面 | 长度 | 写什么 | 不写什么 |
|------|------|--------|----------|
| **What's New 弹窗** | **每条最多一句**（解析器取条目开头的 `**标题**`，否则取第一句） | 新增了什么 / 修复了什么 / 优化了什么 | 设置路径长链、实现细节、issue/PR 堆砌、复述代码 |
| **CHANGELOG.md / GitHub Release** | 第一句 = 弹窗文案；**最多再跟一句**补充 | 入口或范围（如「外观 → 主题」） | 段落、PR 叙述、把调试过程贴进列表 |
| **已发布 `## [X.Y.Z]`** | — | **不回溯改写** | 不要为了新文风去改旧版本章节 |

写作清单：

1. 第一句必须**单独成意**。用户只读这一句也知道本版加了、修了、优化了什么。  
2. 中文约一行、英文约一行；不要逗号从句叠罗汉。  
3. 同一件事只留一条。相关小改合并，不要按 commit / PR 逐条记账。  
4. Issue 号（若需要）放第二句，不要放进第一句。  
5. Highlight 也是一句，不是摘要段。  
6. 分类只用 Added / Changed / Fixed（弹窗中文对应 **新增 / 优化 / 修复**）。  
7. 仍要中英对照，条目数量与顺序锁步。

反例（弹窗会变成墙）：

```markdown
- **Chat stick-to-bottom no longer stops at thinking / tool / body round changes (#931)**: phase auto-collapse and the next output round used to drop pin (2–8px layout ticks were treated as a leave; …).
```

正例：

```markdown
- Chat stays pinned through thinking, tools, and pane resize.
- 修复思考、工具输出和打开侧栏时聊天不跟到底。
```

需要给维护者多写一点时，第二句才写补充：

```markdown
- Settings overlay opacity can be adjusted. Appearance → Theme; 20% floor; not in `.grokskin`.
- 设置页可调节不透明度。外观 → 主题；最低约 20%；不进皮肤包。
```

其它发版规则：

1. **没有对应 `## [X.Y.Z]` 章节 → 禁止 tag**（`release-tag.sh` 与 CI 都会 fail）。  
2. 发版当天把 `[Unreleased]` 里准备进本版的条目**挪进** `## [X.Y.Z]`。  
3. 后续每次功能合并，Agent 应在 PR/提交中**同步改 Unreleased 或即将发的版本节**，并遵守上面的短句规则。  

生成 Release 预览（本地）：

```bash
python3 scripts/changelog-for-release.py 0.1.0
```

## 贡献者 README（强制）

每次正式发版 **必须** 刷新 README 贡献者圆形头像画廊，**不要**手写两套表格 / 方形图 / contrib.rocks。

| 项 | 约定 |
|----|------|
| 脚本 | `python3 scripts/update-contributors.py` |
| 数据源 | GitHub Contributors API（`RongleCat/grok-app`），过滤 bot |
| 展示 | **仅圆形头像**（`border-radius:50%`），中英 README 同一结构 |
| 写入位置 | `README.md` / `README_EN.md` / `README_ZH.md` / `README_RU.md` 内 `<!-- CONTRIBUTORS:START -->` … `END` |
| 禁止 | 贡献者表格 + 方形头像 + `contrib.rocks` 条带（避免双轨维护） |

发版前（工作区可先 dirty）：

```bash
# 需要网络；有 token 时更稳：export GITHUB_TOKEN="$(gh auth token)"
python3 scripts/update-contributors.py
git add README.md README_EN.md README_ZH.md README_RU.md
git commit -m "docs: refresh README contributors gallery"   # 若有变更
```

`scripts/release-tag.sh` 会在 bump 版本 **之前** 自动跑该脚本；若头像块有更新，一并打进 release commit。  
手工 `git tag` 而不走脚本时，**仍须**先跑 `update-contributors.py` 并提交。

## 标准发版步骤（复制即用）

```bash
# 0) 工作区干净、main 最新
git checkout main
git pull origin main   # 若已有远程历史
git status             # 必须 clean

# 1) 写好 CHANGELOG.md → ## [X.Y.Z] - 日期
# 1b) 刷新贡献者圆形头像（亦可交给 release-tag.sh 自动跑）
export GITHUB_TOKEN="$(gh auth token)"   # 推荐，避免 API 限流
python3 scripts/update-contributors.py
# 若 README 有 diff：先 commit docs: refresh README contributors gallery

# 2) 自测（至少）：
pnpm typecheck && pnpm test
# 可选本地装包：pnpm build:mac-arm / pnpm build:win

# 3) 打 tag（会 bump 版本、刷新贡献者、annotated tag）
./scripts/release-tag.sh X.Y.Z
# 确认后推送：
./scripts/release-tag.sh X.Y.Z --push
# 或：git push origin HEAD && git push origin vX.Y.Z
```

若当前 **package 版本已经是 X.Y.Z** 且 CHANGELOG 已写好，只需：

```bash
export GITHUB_TOKEN="$(gh auth token)"
python3 scripts/update-contributors.py
# commit README 变更（如有）
git tag -a vX.Y.Z -m "Release vX.Y.Z"
git push origin main
git push origin vX.Y.Z
```

（或仍走 `release-tag.sh`，脚本会校验 CHANGELOG 并刷新贡献者。）

## CI 行为

| 工作流 | 触发 | 作用 |
|--------|------|------|
| `.github/workflows/ci.yml` | push/PR → main | typecheck、test、`build:ui`、mac/win `cargo test` |
| `.github/workflows/release.yml` | tag `v*` 或手动 | 矩阵：mac×2 + win（setup+portable）+ linux（AppImage/deb/rpm）→ 同一 Release |

Release job 关键：

1. 从 tag 名或 `package.json` 解析版本  
2. `python3 scripts/changelog-for-release.py "$VER"` → `RELEASE_BODY`  
3. `tauri-apps/tauri-action` 构建并挂资产  
4. checksums job 再挂 **官网稳定别名** + `downloads.json`（见下节）

### 仓库权限（人类一次性配置）

GitHub → **Settings → Actions → General → Workflow permissions**  
→ **Read and write permissions**（否则无法创建/更新 Release）。

未配置完整 `APPLE_CERTIFICATE` + App Store Connect API secrets 时 macOS 包**未公证**，属预期；README 保留 `xattr` 说明。Secrets 齐且 `release.yml` 已接线后，正式 tag 会 codesign + notarize。**v0.2.19** 是第一个公证成功的正式版；README 已改成「官方 Release 已公证，`xattr` 仅留给 fork / 旧包」。

## 官网下载契约（grok-app.com）

对接细节（稳定 URL、`downloads.json` 字段、官网构建、短链、禁止事项）见 **[website-downloads.md](./website-downloads.md)**。

摘要：官网另仓静态站，按钮 **302 / 直链** 到 `/releases/latest/download/Grok_mac_*.dmg` 等稳定别名；不要托管或反代安装包；不要用 `grok-desktop-latest`。生成脚本 `scripts/publish-website-downloads.py`。

## macOS「已损坏 / 无法打开」

未签名下载后 Gatekeeper 可能拦截。**用户说明放在 README**（不要每个 Release 正文再贴一遍）：

```bash
xattr -cr /Applications/Grok.app
open /Applications/Grok.app
```

改安装说明时改 `README.md` / `README_EN.md`。

## Windows 说明

- **安装版** NSIS + **绿色版** zip（解压即用）均上传到同一 Release。  
- SmartScreen 可能提示未知发布者 →「更多信息」→「仍要运行」。  
- 需 **WebView2**（Win10/11 多已预装）。  
- 真 Agent 需本机 **Grok Build CLI**（`grok.exe`）。

## Linux 说明

- **AppImage**：通用桌面；`chmod +x` 后运行。  
- **.deb**：Ubuntu / Debian / Mint / Pop!_OS 等。  
- **.rpm**：Fedora / RHEL / openSUSE 等。  
- CI 使用 `ubuntu-22.04` + `rpm` 工具链打出三种格式。

## 本地交叉编译（可选，不替代 CI）

见 [docs/BUILD.md](../BUILD.md)。macOS 上 Windows：

```bash
export PATH="/opt/homebrew/opt/llvm/bin:$PATH"
pnpm setup:cross
pnpm build:win   # tauri + cargo-xwin + makensis
```

注意：`macos-private-api` feature 与 `tauri.conf.json` 的 `macOSPrivateApi: true` 必须一致，否则 Windows 交叉会在 build-script 校验失败。

## 发版后检查清单

**Agent 必须盯到整条 `release` 工作流结束**，不能只看 tag 已推或 mac/linux 先绿。`fail-fast: false` 时某一平台失败仍可能先挂上其它安装包，形成「Latest 缺 Windows」这类半成品（见 v0.2.32 / #1039）。

- [ ] Actions `release`：**四个 Build job 全绿**（macOS-ARM64 / macOS-x64 / Windows-x64 / Linux-x64）  
- [ ] **`Gate — all platform installers present` 全绿**（`scripts/assert-release-assets.sh`；缺 setup.exe / portable.zip 等会硬失败）  
- [ ] `Publish SHA256SUMS + website downloads` 全绿  
- [ ] GitHub Release 页含：两 dmg、**`*-setup.exe`、`*-portable.zip`**、AppImage、deb、rpm  
- [ ] 同一 Release 含稳定别名（`Grok_mac_x64.dmg` / `Grok_windows_x64-setup.exe` 等）+ `downloads.json`
- [ ] Release body 仅为该版本变更列表（无整页下载表/安装长文）  
- [ ] README 下载链接指向 Releases（相对路径已写）  
- [ ] 版本号与 tag 一致  

本地快速核对（tag 已出包后）：

```bash
bash scripts/assert-release-assets.sh vX.Y.Z --repo RongleCat/grok-app
gh release view vX.Y.Z --json assets --jq '[.assets[].name]'
```

失败时：

| 现象 | 处理 |
|------|------|
| Resource not accessible | 打开 workflow 写权限 |
| no CHANGELOG section | 补章节后删 tag 重打 |
| macOS 证书 import 失败 | 勿传空 `APPLE_*` secrets |
| 前端 typecheck 挂 | 本地 `pnpm typecheck` 修后推修丁 tag 或新 patch 版 |
| **Gate / Windows 红，Latest 缺 setup.exe** | **不要当发完。** 修编译后打新 patch（如 0.2.33）；不要只靠重跑已坏 tag（若坏在该 commit） |
| `assert-release-assets` 报 missing | 对照日志修对应矩阵腿，再发新版本或在修好后 `workflow_dispatch` 重建同一 tag |

## 禁止事项

- 不在未写 CHANGELOG 时 tag  
- 不把 `secrets.json` / `auth.json` / 真实 API key 打进仓库  
- 不把 `dist-installers/`、`src-tauri/target/` 提交进 git  
- 不用 `window.confirm` 等（产品规则见 dialogs.md）  
- 不手写覆盖 CI 生成的 Release body（改脚本 + CHANGELOG）  
- 不把设置路径、实现细节、issue 堆砌写进 What's New **第一句**（弹窗只展示这一句）  
- 不回溯改写已发布的 `## [X.Y.Z]` 章节来套新文风

## 相关路径速查

| 路径 | 用途 |
|------|------|
| `CHANGELOG.md` | 版本更新列表 SoT |
| `scripts/changelog-for-release.py` | Release body = 该版本 CHANGELOG 章节（精简） |
| `scripts/release-tag.sh` | bump + tag |
| `.github/workflows/release.yml` | 三端构建与上传 |
| `scripts/publish-website-downloads.py` | 官网稳定别名 + `downloads.json` |
| [website-downloads.md](./website-downloads.md) | 官网下载对接契约（完整） |
| `docs/BUILD.md` | 本地构建细节 |
| `README.md` / `README_EN.md` | 用户安装与 Gatekeeper |
