# Grok App 桌面端构建与发布

支持平台：

| 平台 | Triple | 本地构建 | CI Release 产物 |
|------|--------|----------|-----------------|
| macOS Apple Silicon | `aarch64-apple-darwin` | ✅ | `.dmg` |
| macOS Intel | `x86_64-apple-darwin` | ✅（在 Apple Silicon 上交叉） | `.dmg` |
| Windows x64 | `x86_64-pc-windows-msvc` | ✅ 本机 Windows，或 **macOS/Linux 经 cargo-xwin** | NSIS `*-setup.exe` + **绿色版** `*-portable.zip` |
| Linux x64 | `x86_64-unknown-linux-gnu` | ✅ 本机 Linux | **AppImage** + **.deb** + **.rpm** |

> macOS / Linux 交叉打 Windows 安装包使用 Tauri 官方 runner：`cargo-xwin` + `makensis`（NSIS）。  
> 见 [Build Windows apps on Linux and macOS](https://v2.tauri.app/distribute/windows-installer/#build-windows-apps-on-linux-and-macos)。

## 窗口 chrome

| 平台 | 配置 | UI |
|------|------|-----|
| macOS | `tauri.macos.conf.json`：`decorations` + `titleBarStyle: Overlay` + 透明侧栏 | 原生 traffic lights |
| Windows | `tauri.windows.conf.json`：`decorations: false`、非透明 | 自绘 min / max / close |

关闭窗口 → 隐藏到托盘；退出请用托盘 **Quit Grok**。

## 1. 本地环境

```bash
# 依赖：Node 22+、pnpm 9、Rust stable、Xcode CLT (macOS)
pnpm install
pnpm setup:cross   # rust targets + (macOS) cargo-xwin / nsis / llvm 检查
```

### macOS

- Xcode Command Line Tools：`xcode-select --install`
- Apple Silicon 上构建 Intel：`rustup target add x86_64-apple-darwin`（脚本已处理）
- **Windows 交叉编译额外依赖**（`setup:cross` 会检查）：
  ```bash
  brew install llvm makensis
  cargo install --locked cargo-xwin
  # 建议把 clang-cl 放进 PATH（Apple Silicon）：
  export PATH="/opt/homebrew/opt/llvm/bin:$PATH"
  ```
- 首次 Windows 构建会下载 MSVC CRT/SDK 到 `~/.cache/cargo-xwin`（与 GrokGo 可共用缓存）

### Windows（原生）

- [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)（C++ 工作负载）
- [WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/)（多数 Win10/11 已带）
- Rust MSVC toolchain：`rustup default stable-x86_64-pc-windows-msvc`

### Linux（含 Arch / Ubuntu / Debian）

```bash
# Debian/Ubuntu
# Prefer Ayatana only (libappindicator3-dev conflicts with libayatana-appindicator3-dev).
sudo apt install libwebkit2gtk-4.1-dev librsvg2-dev \
  patchelf libgtk-3-dev libayatana-appindicator3-dev libssl-dev

# Arch
sudo pacman -S webkit2gtk-4.1 base-devel curl wget file openssl appmenu-gtk-module \
  libappindicator-gtk3 librsvg
```

然后：

```bash
pnpm build:linux
# 或
./scripts/build-local.sh linux
```

产物：`src-tauri/target/x86_64-unknown-linux-gnu/release/bundle/`  
（`appimage/`、`deb/`、`rpm/` —— 对应 Ubuntu/Debian 系与 Fedora/RHEL 系）。

构建 RPM 需要 `rpm` 工具：`sudo apt install rpm`（Debian/Ubuntu CI 已装）。

## 2. 本地构建命令

```bash
pnpm build              # 当前主机默认 target
pnpm build:mac-arm      # macOS ARM
pnpm build:mac-intel    # macOS Intel
pnpm build:mac-all      # ARM + Intel（仅 macOS）
pnpm build:win          # Windows（macOS/Linux → cargo-xwin；Windows → 原生）
pnpm build:linux        # Linux x64（需 Linux 主机）
pnpm build:all          # mac-arm + mac-intel + win（仅 macOS）

# 或直接：
./scripts/build-local.sh mac-arm
./scripts/build-local.sh win
./scripts/build-local.sh linux
./scripts/build-local.sh all
```

`build:win` 在 macOS 上等价于：

```bash
pnpm exec tauri build --runner cargo-xwin --target x86_64-pc-windows-msvc
```

产物目录：

```
src-tauri/target/<triple>/release/bundle/
  macos/     # .app / .dmg  （产品名 Grok）
  nsis/      # Windows 安装版（*-setup.exe）
  deb/       # Debian/Ubuntu .deb
  rpm/       # Fedora/RHEL .rpm
  appimage/  # 通用 Linux AppImage
src-tauri/target/<triple>/release/Grok.exe   # Windows 裸二进制 → CI 打成绿色版 zip
```

拷贝测试建议：

```bash
mkdir -p dist-installers
cp src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/*.dmg dist-installers/
cp src-tauri/target/x86_64-apple-darwin/release/bundle/dmg/*.dmg dist-installers/
cp src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/*-setup.exe dist-installers/
# 绿色版：zip release/Grok.exe
cp src-tauri/target/x86_64-unknown-linux-gnu/release/bundle/appimage/* dist-installers/ 2>/dev/null || true
cp src-tauri/target/x86_64-unknown-linux-gnu/release/bundle/deb/* dist-installers/ 2>/dev/null || true
cp src-tauri/target/x86_64-unknown-linux-gnu/release/bundle/rpm/* dist-installers/ 2>/dev/null || true
```

## 3. GitHub Actions 发布（推荐）

> **AI / 维护者完整 checklist：** [docs/llm-wiki/release.md](./llm-wiki/release.md)（发版步骤、CHANGELOG 写法、损坏处理、禁止事项）。

工作流：`.github/workflows/release.yml`  
发版说明：从 `CHANGELOG.md` 对应版本章节生成（`scripts/changelog-for-release.py`），**仅本版变更**；安装 / Gatekeeper 见 README。

### 触发方式

1. **推送版本 tag**（推荐、稳定）  
   ```bash
   # 1) 先在 CHANGELOG.md 写好 ## [X.Y.Z] - YYYY-MM-DD
   # 2) 提交干净 main 后：
   ./scripts/release-tag.sh 0.1.1
   # 或直接推送：
   ./scripts/release-tag.sh 0.1.1 --push
   ```
2. **Actions → release → Run workflow**（手动）

`release-tag.sh` 会：

- 校验 `CHANGELOG.md` 存在该版本章节（否则失败）
- 同步 `package.json` / `tauri.conf.json` / `Cargo.toml` / i18n `versionFooter`
- 提交 `chore: release vX.Y.Z` 并打 annotated tag
- 可选 `--push` 触发 CI

没有对应 CHANGELOG 章节时，**tag 与 CI release 都会失败**（有意为之）。

### 仓库设置

- **Settings → Actions → General → Workflow permissions**  
  勾选 **Read and write permissions**（用于创建 Release 并上传资产）

### 可选：签名 Secrets

未配置签名时仍会出包；macOS 可能提示「已损坏」，Windows 可能 SmartScreen 拦截。

| Secret | 用途 |
|--------|------|
| `APPLE_CERTIFICATE` 等 | Apple 公证 / 签名（见 [Tauri macOS signing](https://v2.tauri.app/distribute/sign/macos/)） |
| `GROK_UPDATER_PUBLIC_KEY` | 应用内自动更新公钥（与 endpoint 一起嵌入 release 构建） |
| `TAURI_SIGNING_PRIVATE_KEY` | Tauri updater 签名私钥（启用自动更新时必需） |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 私钥密码（可为空） |

应用内自动更新详情见 [desktop-auto-update.md](./desktop-auto-update.md)。  
Release CI 在 secrets 齐全时会生成 `tauri.release.conf.json` 并注入 `GROK_UPDATER_*`。

**注意：** 不要在 workflow 里传入**空**的 `APPLE_*` secrets，否则 codesign 导入会失败。

### Release 内容

矩阵会为以下平台上传安装包到同一 GitHub Release：

- macOS ARM64  
- macOS x64  
- Windows x64  

Release body = 下载表 + 该版本 CHANGELOG + 安装说明（含 `xattr`）。

## 4. 版本号约定

保持一致（`release-tag.sh` 会自动改）：

- `package.json` → `version`
- `src-tauri/tauri.conf.json` → `version`
- `src-tauri/Cargo.toml` → `[package].version`
- `src/i18n/messages.ts` → `app.versionFooter` 中的 `Grok vX.Y.Z`

Tag 格式：`v0.1.1`（前缀 `v` + semver）。

## 5. 故障排查

| 现象 | 处理 |
|------|------|
| CI “Resource not accessible by integration” | 打开 workflow 写权限 |
| release job：no CHANGELOG section | 补 `## [X.Y.Z]` 后再 tag |
| macOS Intel build 缺 target | 确认 rustup 安装了 `x86_64-apple-darwin` |
| Windows 交叉缺 makensis / clang-cl | `brew install makensis llvm`；`export PATH="$(brew --prefix llvm)/bin:$PATH"` |
| cargo-xwin 首次很慢 | 正常：在拉 CRT/SDK；缓存目录 `~/.cache/cargo-xwin` |
| Windows 本机无法交叉 | 用 `pnpm build:win`（cargo-xwin）或 CI |
| macOS 下载后打不开 | 未签名：系统设置 → 隐私与安全性 → 仍要打开；或 `xattr -cr /path/to/Grok.app` |
| Windows 找不到 grok CLI | 安装 Grok Build 并确保 `%USERPROFILE%\.grok\bin` 或 PATH 上有 `grok.exe` |
