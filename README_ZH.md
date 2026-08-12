<p align="center">
  <img src="assets/logo.png" alt="Grok App" width="128" height="128" />
</p>

<h1 align="center">Grok App</h1>

<p align="center"><strong>本机 Grok Build 的桌面指挥台</strong></p>
<p align="center"><em>Sessions, projects, media, automations — for the real <code>grok</code> CLI</em></p>

<p align="center">
  <a href="./README.md">English</a> ·
  <a href="./README_ZH.md">中文</a>
</p>

<p align="center">
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
> ## 说明
>
> **Grok App 不是 xAI 官方产品。** 它把本机 [Grok Build](https://x.ai) CLI（`grok agent stdio`）收成桌面工作台：会话、项目、权限、媒体预览与已安排任务。
>
> 真 Agent 能力依赖本机已安装并可登录的 **Grok Build CLI**。没有 CLI 时可用首次向导安装，或开发态 `GROK_APP_ACP=mock` 做 UI 联调。

---

## 目录

1. [简介](#简介)
2. [功能特性](#功能特性)
3. [界面预览](#界面预览)
4. [安装与使用](#安装与使用)
5. [macOS 无法打开 / 提示已损坏](#macos-无法打开--提示已损坏)
6. [Linux 黑屏 / 空白窗（WebKit）](#linux-黑屏--空白窗webkit)
7. [Linux 沙箱 / 用户命名空间（Ubuntu 24.04+）](#linux-沙箱--用户命名空间ubuntu-2404)
8. [配置目录](#配置目录)
9. [开发与构建](#开发与构建)
10. [文档与贡献](#文档与贡献)
11. [贡献者](#贡献者)
12. [关注作者](#关注作者)

---

## 简介

在终端里跑 `grok` 很强，但日常工作台还缺一块：多项目、多会话、权限条、富媒体预览、定时任务、中英文界面。

**Grok App** 解决的是「指挥台」问题：

1. 安装 App，准备好 Grok Build CLI  
2. 添加项目 / 新建会话  
3. 连接 Agent，用 Ask 或 YOLO 发消息  
4. 预览产物、安排自动化、在设置里管账号与中转  

技术栈：**Tauri 2 + Rust · React + TypeScript + Vite · Tailwind CSS**

---

## 功能特性

| 类别 | 说明 |
|------|------|
| **真 Build 会话** | 默认 `grok agent stdio`（ACP）；Host 独占会话 FSM；可选远程 ACP |
| **项目与会话** | 多项目信任目录、侧栏虚拟列表、归档 / orphan、分叉与回退；**shared 模式导入 CLI 会话** |
| **多会话流式** | 切换聊天时后台继续流式 / 权限；并发上限与闲置回收 |
| **Git 工作树** | 项目 chip 列出 linked worktree，一键切换会话 cwd（非 git 不展示） |
| **权限** | 默认 Ask；Allow once / session / Deny；YOLO；**按项目**默认权限阶梯 |
| **Plan / Goal** | 顶部执行进度；资源面板 Markdown 审阅与步骤；Goal 入口 |
| **斜杠 · 扩展** | 斜杠面板、Skills；设置 → 扩展管理 MCP / Plugins |
| **Composer** | 忙时后续消息队列；粘贴截图附件；上下文用量芯片 |
| **媒体与文件** | 图 / 视频 / PDF / Office / 代码预览；资源窗可**编辑保存**文本；Changes（会话 diff + 工作区 git） |
| **Agent 运行时** | 卡顿取消；结构化错误卡；会话**诊断包**导出；工具/权限未完不提前「就绪」 |
| **自动化** | 已安排任务列表；对话里自然语言创建（静默 fence，不展示 JSON） |
| **账号与额度** | 多账号切换、官方登录、SuperGrok 额度与热力图、自定义中转本地用量 |
| **自定义中转** | 独立 `GROK_HOME` agent 配置，避免污染默认 `~/.grok` |
| **安全** | API Key 可选系统钥匙串（默认 `secrets.json` 0600）；store 写锁；应用内确认框 |
| **i18n** | 简体中文 / 繁體中文 / English 与托盘 |
| **跨平台打包** | macOS ARM / Intel · Windows x64（安装版 + 绿色版）· Linux x64（AppImage / deb / rpm） |

---

## 界面预览

> 截图来自当前开发版（macOS）。

| 工作台 · SuperGrok | 账户与额度 |
|:---:|:---:|
| ![Workbench](assets/screenshots/workbench.png) | ![Account](assets/screenshots/account.png) |

| 浅色主题 | 会话与媒体 |
|:---:|:---:|
| ![Light](assets/screenshots/light.png) | ![Chat](assets/screenshots/chat.png) |

---

## 安装与使用

### 1. 下载

从 [Releases](https://github.com/RongleCat/grok-app/releases) 下载对应平台安装包：

| 平台 | 文件 |
|------|------|
| macOS Apple Silicon | `Grok_*_aarch64.dmg` |
| macOS Intel | `Grok_*_x64.dmg` |
| Windows x64 | `*-setup.exe` 安装版 + `*-portable.zip` 绿色版 |
| Linux x64 | `AppImage` / `.deb` / `.rpm` |

安装包产品名为 **Grok**（与窗口标题一致）。

**Arch / Manjaro / EndeavourOS 等：** **AppImage** 不依赖发行版打包格式（`chmod +x` 后运行）。官方 CI 不单独发布 AUR 包。在 **Wayland（如 Hyprland）+ AMD** 上，部分主机的 AppImage 会黑屏——可改用 **`.deb` / `.rpm`**（系统 WebKit），或见 [Linux 黑屏 / 空白窗](#linux-黑屏--空白窗webkit)。

#### Windows SmartScreen

社区 / 未 Authenticode 签名的 Windows 安装包首次运行时，SmartScreen 可能提示「Windows 已保护你的电脑 / 未知发布者」——点 **更多信息 → 仍要运行**；有疑虑时请对照 Release 中的 `SHA256SUMS` 校验哈希。CI 在配置了 `WINDOWS_CERTIFICATE` + `WINDOWS_CERTIFICATE_PASSWORD` 时可对安装包签名（见 `docs/BUILD.md`）；已签名包显示证书上的发布者名称。

#### 应用内自动更新

**设置 → 关于** 中的静默更新**仅**在**已签名的生产构建**上可用（嵌入 Tauri updater 公钥 + 滚动 Release 上对应签名包）。未签名社区包、本地 `pnpm dev` / debug 构建，以及部分包类型（如 Linux 非 AppImage）仍走 **打开 GitHub Release / 下载安装包** 路径——**不会**静默自动更新。完整矩阵与维护清单见 [docs/desktop-auto-update.md](./docs/desktop-auto-update.md)。

### 2. 首次使用

1. 启动 App → **Setup 向导** 确认 CLI 已安装（可一键多镜像安装）  
2. （可选）登录官方账号 / 填 API Key / 配置自定义中转；可跳过  
3. **添加项目** → 选择并信任文件夹  
4. **连接 Agent** → Ready 后发消息  
5. 权限条默认 **Ask**；需要无人值守时再开 YOLO  

### 3. 依赖

- 本机 **Grok Build CLI**（`grok`），常见路径：`~/.grok/bin/grok` 或 PATH  
- Windows：`%USERPROFILE%\.grok\bin\grok.exe` 或 PATH  

---

## macOS 无法打开 / 提示已损坏

当前 Release **未做 Apple 公证**（需付费开发者账号）。从 GitHub 下载后，Gatekeeper 可能提示「已损坏」「无法验证开发者」等，属预期行为。

**推荐处理：**

```bash
# 将 App 拖到「应用程序」后执行
xattr -cr /Applications/Grok.app
open /Applications/Grok.app
```

**其他方式：**

- Finder 中 **右键** App → **打开** → 再次确认打开  
- **系统设置 → 隐私与安全性** → 对拦截项点 **仍要打开**  

请仅从本仓库官方 [Releases](https://github.com/RongleCat/grok-app/releases) 下载。

---

## Linux 黑屏 / 空白窗（WebKit）

部分 **Wayland** 桌面（尤其是 **Hyprland + AMD**）上，官方 **AppImage** 可能只弹出**全黑窗口**。宿主进程仍在跑（媒体服务、Agent ACP、登录），但内置 WebKitGTK 无法绘制。日志常见：

```text
Could not create default EGL display: EGL_BAD_PARAMETER
```

这是 **Tauri 2 + AppImage + WebKitGTK** 一类问题：AppImage 内置的是 CI 容器（Ubuntu 22.04）里的 WebKit，可能与主机较新的 Mesa/DRI 栈不兼容。同一机器上的 **`.deb` / `.rpm`** 链接**系统** WebKit，通常正常。详见 [#539](https://github.com/RongleCat/grok-app/issues/539) 与 [Tauri Linux 图形说明](https://v2.tauri.app/develop/debug/linux-graphics/)。

**按顺序尝试：**

1. **优先用 `.deb` / `.rpm`**（系统 WebKit）。Arch 可用 `debtap` 转换，或解压 `.deb` 后直接跑二进制。
2. **用系统 WebKit 跑 AppImage**（Arch + Hyprland + AMD 已验证）：

```bash
# 一次性解压
./Grok_*.AppImage --appimage-extract
# 或：bash scripts/run-linux-appimage-system-webkit.sh ./Grok_*.AppImage

export LD_LIBRARY_PATH=/usr/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}
export WEBKIT_EXEC_PATH=/usr/lib/webkit2gtk-4.1
export WEBKIT_DISABLE_DMABUF_RENDERER=1
export WEBKIT_DISABLE_COMPOSITING_MODE=1
export GDK_BACKEND=x11
unset APPDIR APPIMAGE
./squashfs-root/usr/bin/grok-app
```

Debian/Ubuntu 多架构路径请改用 `/usr/lib/x86_64-linux-gnu` 与 `/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1`。系统需已安装 WebKit（Arch：`webkit2gtk-4.1`；Debian/Ubuntu：`libwebkit2gtk-4.1-0`）。

3. 仅设环境变量试一下（对 NVIDIA/DMABUF 有时有效；**对上面的 EGL 报错往往不够**）：

```bash
WEBKIT_DISABLE_DMABUF_RENDERER=1 ./Grok_*.AppImage
```

---

## Linux 沙箱 / 用户命名空间（Ubuntu 24.04+）

在 **Ubuntu 24.04+**（以及部分其他发行版）上，内核可能默认：

```text
kernel.apparmor_restrict_unprivileged_userns = 1
```

Grok 默认 Agent 沙箱（`--sandbox workspace`）依赖 **bubblewrap**，需要非特权用户命名空间。若内核拦截，Agent 会立刻退出，应用可能显示 **Agent process ended** / `SANDBOX_BLOCKED`（stderr 常见 `bwrap: setting up uid map: Permission denied`）。见 issue [#541](https://github.com/RongleCat/grok-app/issues/541)。

**修复（保留沙箱）：**

```bash
sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0
echo 'kernel.apparmor_restrict_unprivileged_userns=0' | sudo tee /etc/sysctl.d/99-userns.conf
```

**无需 sudo 的绕过：** **设置 → 运行环境 → 沙箱 → off**（跳过 bwrap，失去系统级隔离）。

当 sysctl 受限且沙箱不是 `off` 时，Doctor 也会提示此项。

---

## 配置目录

默认数据根（可用环境变量 **`GROK_APP_HOME`** 覆盖）：

| 平台 | 典型路径 |
|------|----------|
| macOS | `~/Library/Application Support/com.grokapp.grok-app/` |
| Windows | `%APPDATA%\grokapp\grok-app\` |
| 回退 | `~/.grok-app/` |

```text
<app-data>/
  projects.json
  sessions_index.json
  settings.json
  secrets.json          # 元数据（+ API key 回退）；密钥优先系统钥匙串
  automations.json
  projects/
  sessions/
  logs/
  agent-home/           # 独立模式 GROK_HOME（providers / config.toml）
```

API 密钥优先写入系统钥匙串（macOS Keychain / Windows Credential Manager /
Linux Secret Service）；不可用时回退到 `secrets.json`（mode `0600`）。请勿提交密钥。

Grok Build 自身配置仍在 **`~/.grok`**（CLI 登录、`auth.json` 等）。  
**shared** 会话模式可与 CLI 共用 `~/.grok`；**independent** 模式使用 `agent-home/`。

---

## 开发与构建

```bash
# 依赖：Node 22+、pnpm 9、Rust stable、Xcode CLT (macOS)
pnpm install

# 开发（前端 + Tauri，默认真 CLI）
pnpm dev

# 仅前端
pnpm dev:ui

# 无 CLI 的 mock 联调
GROK_APP_ACP=mock pnpm dev

# 检查
pnpm typecheck && pnpm test
cd src-tauri && cargo test

# 生产构建
pnpm build
```

交叉编译、发版与可选签名见 [docs/BUILD.md](./docs/BUILD.md)。

发版（需先写好 `CHANGELOG.md` 对应章节）：

```bash
./scripts/release-tag.sh 0.1.1          # 本地 tag
./scripts/release-tag.sh 0.1.1 --push   # 推送后触发 CI 打安装包
```

---

## 文档与贡献

| 对象 | 入口 |
|------|------|
| AI Agent / 产品规则 | [`docs/llm-wiki/`](./docs/llm-wiki/) |
| 构建与发布 | [docs/BUILD.md](./docs/BUILD.md) |
| 更新日志 | [CHANGELOG.md](./CHANGELOG.md) |
| 贡献指南 | [CONTRIBUTING.md](./CONTRIBUTING.md) |
| 行为准则 | [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) |
| 安全披露 | [SECURITY.md](./SECURITY.md) |

欢迎 Issue 与 PR。

## 贡献者

<!-- CONTRIBUTORS:START -->
感谢所有为 Grok App 做出贡献的人！以下为 GitHub 仓库全部人类贡献者（按 commits 降序，2026-08-12 更新）。

<p align="center">
  <a href="https://github.com/RongleCat" title="RongleCat"><img src="https://github.com/RongleCat.png?size=96" width="72" height="72" alt="RongleCat" style="border-radius:50%" /></a>
  <a href="https://github.com/sonnemusk" title="sonnemusk"><img src="https://github.com/sonnemusk.png?size=96" width="72" height="72" alt="sonnemusk" style="border-radius:50%" /></a>
  <a href="https://github.com/shiaho777" title="shiaho777"><img src="https://github.com/shiaho777.png?size=96" width="72" height="72" alt="shiaho777" style="border-radius:50%" /></a>
  <a href="https://github.com/jason920612" title="jason920612"><img src="https://github.com/jason920612.png?size=96" width="72" height="72" alt="jason920612" style="border-radius:50%" /></a>
  <a href="https://github.com/ChenYCL" title="ChenYCL"><img src="https://github.com/ChenYCL.png?size=96" width="72" height="72" alt="ChenYCL" style="border-radius:50%" /></a>
  <a href="https://github.com/1parado" title="1parado"><img src="https://github.com/1parado.png?size=96" width="72" height="72" alt="1parado" style="border-radius:50%" /></a>
  <a href="https://github.com/enderzcx" title="enderzcx"><img src="https://github.com/enderzcx.png?size=96" width="72" height="72" alt="enderzcx" style="border-radius:50%" /></a>
  <a href="https://github.com/lunar-me" title="lunar-me"><img src="https://github.com/lunar-me.png?size=96" width="72" height="72" alt="lunar-me" style="border-radius:50%" /></a>
  <a href="https://github.com/Sdefendre" title="Sdefendre"><img src="https://github.com/Sdefendre.png?size=96" width="72" height="72" alt="Sdefendre" style="border-radius:50%" /></a>
  <a href="https://github.com/2530185073" title="2530185073"><img src="https://github.com/2530185073.png?size=96" width="72" height="72" alt="2530185073" style="border-radius:50%" /></a>
  <a href="https://github.com/a70win-wq" title="a70win-wq"><img src="https://github.com/a70win-wq.png?size=96" width="72" height="72" alt="a70win-wq" style="border-radius:50%" /></a>
  <a href="https://github.com/falser101" title="falser101"><img src="https://github.com/falser101.png?size=96" width="72" height="72" alt="falser101" style="border-radius:50%" /></a>
  <a href="https://github.com/fannnzhang" title="fannnzhang"><img src="https://github.com/fannnzhang.png?size=96" width="72" height="72" alt="fannnzhang" style="border-radius:50%" /></a>
  <a href="https://github.com/jchacker5" title="jchacker5"><img src="https://github.com/jchacker5.png?size=96" width="72" height="72" alt="jchacker5" style="border-radius:50%" /></a>
  <a href="https://github.com/rkhrkh" title="rkhrkh"><img src="https://github.com/rkhrkh.png?size=96" width="72" height="72" alt="rkhrkh" style="border-radius:50%" /></a>
  <a href="https://github.com/Sixmin" title="Sixmin"><img src="https://github.com/Sixmin.png?size=96" width="72" height="72" alt="Sixmin" style="border-radius:50%" /></a>
  <a href="https://github.com/tisrop" title="tisrop"><img src="https://github.com/tisrop.png?size=96" width="72" height="72" alt="tisrop" style="border-radius:50%" /></a>
</p>

[完整贡献图 →](https://github.com/RongleCat/grok-app/graphs/contributors)
<!-- CONTRIBUTORS:END -->

## License

[MIT](./LICENSE) © RongleCat

---

## 关注作者

| 渠道 | 入口 |
|------|------|
| **X / Twitter** | [铁柱AGI @cgnot996](https://x.com/cgnot996) |
| **微信公众号** | 搜索 **「铁柱AGI」**（页顶左侧） |
| **微信交流群** | 扫页顶右侧二维码 |

[linux.do](https://linux.do/) 学AI，上L站

如果 Grok App 对你有帮助，欢迎给仓库点个 Star ⭐
