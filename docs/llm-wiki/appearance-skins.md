# 外观皮肤包（Appearance skins）

App 自有的外观分享系统（**不是** CLI plugin marketplace）。

## 包布局（`.grokskin` ZIP）

```
manifest.json            # schemaVersion: 1
assets/wallpaper.<ext>   # 可选，恰好一个
preview.jpg              # 可选
```

允许的顶层名（规范化后小写）：`manifest.json`、`preview.jpg`、`assets/`、`assets/wallpaper.{jpg,jpeg,png,webp,gif,mp4,webm}`。未知顶层名 fail-closed（`invalid_pack`）。忽略 `__macosx/**`、`.ds_store`、`._*`。只接受 Stored / Deflated。

字段：内置 `skin`、`scrim`（遮罩**透明度** 0–100）、`wallpaper`（含 `focus` / `clip` / `sha256`）、可选 `textColor`（`#rgb` / `#rrggbb`，缺省或非法 = 跟随浅深色主题；**只**染侧栏 / 顶栏 / 首页欢迎 / 连接条 / 右侧栏顶栏，经 `--appearance-chrome-ink`，**不**改全局 `--text-primary`）、可选 `fontShadow`（bool，缺省 `false`）、可选 `composerOpacity`（输入框不透明度 0–100，缺省 100，**不**与 `scrim` 合并）、可选 `uiOpacity`（文件卡 / 代码块 / 用户气泡 / 资源栏筛选与打开 / 顶栏状态胶囊 / 账号头像 0–100，缺省 100，**不**与 `scrim` 合并；绘制时保底 20%）。App 另有本地 `wallpaper-blur`（遮罩**模糊**，与 `scrim` 独立；皮肤包暂不携带）和 `settings-opacity`（设置页底色不透明度 0–100，缺省 100，**不**与 `scrim` 合并、**不**进皮肤包；绘制时 20% 保底不参与计算，其余 80% 映射滑块）。`tokens` / `style` / `css` 或 `schemaVersion !== 1` → `unsupported_schema`。未知 `skin` **不**整包失败：回落 `default` + `warnings: ["unknown_skin"]`。`wallpaper == null` 默认清除接收方壁纸（`will_clear_wallpaper`）。

**壁纸导出 bake：** 用户导出 / 分享时，按**当前应用窗口里实际看到的那一块**裁进包里（`.app-wallpaper-media` 宽高比 + 当前 `focus`；缺 focus 当默认 cover）。即使没手动拉焦点，窗口比例和素材不一致时也会裁掉 cover 多出来的边。裁后 `focus` 复位默认（cx=0.5, cy=0.5, zoom=1），接收方 cover-fill 与导出时看起来一致，包体积最小。当前窗口正好等于素材比例且无缩放时不重编码。本地预设库与 undo 快照仍保留原片 + 参数（套用预设可再编辑）；只有用户面向的 export 才 bake。

- **静图**（jpeg/png/静态 webp/静态 gif）：`image` crate 裁像素。jpeg 仍出 jpeg；其余出 png。动图 gif/webp **不裁**（保留原文件 + `focus`，避免拍扁动画）。
- **视频**：系统 ffmpeg 裁偶数像素画面并按 `clip` 截时长（无声 H.264 mp4），然后去掉 `clip`。App **不内置** ffmpeg。缺 ffmpeg 且需要裁切/截取时 **不阻断导出**：带原片 + `focus` / `clip` 出包，并返回 `warning: ffmpeg_unavailable`。

导出 manifest 可带瞬时 `viewAspect`（窗口宽/高），bake 后从包中剥掉；导入忽略该字段。

**从不写入、不应用 `themePreference`。** 导出 / 保存当前不写该字段；导入忽略。

当前生效壁纸仍只活在 IndexedDB。预设在 `{app_data}/skin-presets/`（入库目录名总是新 UUID）。磁盘合计上限 4 GiB（含 undo + staging + catalog cache；不含 IDB 当前壁纸与 `{app_data}/wallpapers/`）。

**预设预览 / Apply：** `skin_preset_materialize` 直接检视库目录（`inspect_unpacked_dir`），不再 zip→解压。壁纸路径指向库内原片；大视频信任入库时已校验的 `sha256`，弹窗可即时打开。预设卡片：静图 / `preview.jpg` / 动图 gif 作 CSS 背景；`.mp4`/`.webm` 用 loopback media HTTP 的静音循环 `<video>`（不依赖 ffmpeg 海报）。配色卡与无壁纸预设卡用平面色块，不用对角浮雕渐变。

## K19 官方 origin allowlist

`OFFICIAL_SKIN_CATALOG_URL` 保持 `""` 直至日后填入。官方浏览按钮在 URL 为空时隐藏（卡片上仍保留 `settings-anchor-skin-catalog` 占位）。`repo=official` → `official_unconfigured`，**绝不**回落用户源。

官方 pack / preview / 重定向 host 必须 ∈

- `github.com`
- `github.io`
- `githubusercontent.com`
- `release-assets.githubusercontent.com`
- `objects.githubusercontent.com`
- `x.ai`

（精确匹配或 `host.endsWith('.'+entry)`）。用户附加源：HTTPS-only，上限 5，`downloadUrl` / `previewUrl` **必须与该 catalog 同 origin**。

网络只走 Host `safe_https_get`（逐跳 https、无 userinfo、解析后 IP 非私网/回环/链路本地/ULA/元数据）。**禁止** `wallpaper_source::fetch_media`。

## `grok://` + `grok-app:` 双认

注册 scheme 现用 `grok`。解析层同时接受 `grok-app:`（迁移窗口）。

```
grok://skin/import?url=https%3A%2F%2Fskins.example%2Fpacks%2Fharbor.grokskin
grok://skin/import?repo=official&id=harbor-dusk
```

整段 URI ≤ 2048；尾斜杠可；忽略 fragment；禁止 userinfo；`url` 与 `repo` 互斥；重复 query 键拒绝；只做一次 percent-decode；`+` 不是空格。argv / 文件关联只认 `.grokskin`（不猜 `.zip`）。`--fire-due-schedules` 优先：不写 pending、不 emit、不 `show_main_window`。

`PendingSkinImport` 单槽 last-write-wins。前端只 `take_pending` 再走同一条预览。

## 从不自动 apply

文件 / 预设 / 仓库 / 深链都进入 `SkinImportPreviewModal` 确认。确认后 `applySkinChoice(..., { applyPreferredTheme: false })`，不调用 `applyThemeChoice`。

## 网站 Apply（现阶段）

官方 catalog URL 为空期间，网站**只用** `url=`（加下载 `.grokskin` 兜底）。不要出 `repo=` 按钮。不要期望自动套用。

```js
window.location.href =
  `grok://skin/import?url=${encodeURIComponent(packUrl)}`;
```

`encodeURIComponent` 一次。不把 token 放进 `url=`。若日后注册改为 `grok-app://`，网站同步改；桌面解析层已双认。
