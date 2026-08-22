# PR #785 审核记录（fix 阶段）：**PENDING — pi 服务不可用**

- 分支 `codex/clippy-zero-warnings`（f800fbf2），Fixes #785。
- 目标：`cargo clippy --all-targets` 在 macOS/Linux/Windows 主机构建恢复 0 警告（98 → 0），无行为变更。

## ⚠️ pi 审核校对状态

按 AGENTS.md §8 强制流程，修复完成后须由 `pi -p`（tools: read,bash）审核校对。
**2026-08-22 尝试 5 次（间隔递增至 3 分钟），全部返回 `503 Service temporarily unavailable`，
含最小连通性探测。按规则不以自我复查/子 agent/其它模型顶替，本项保持未完成状态。**
pi 恢复后补跑审核并回填结论；draft PR 转正前必须完成。

## 本地验证证据（非 pi 结论，仅为机器门禁）

| 门禁 | 结果 |
|------|------|
| `cargo clippy --all-targets` | **0 warnings**（基线 98） |
| `cargo fmt --all -- --check` | clean |
| `cargo test` | 1414 passed; 0 failed; 1 ignored |
| 前端 | 未触碰 |
| Windows 目标本地交叉编译 | 不可行：`ring` C 依赖需 MSVC C 编译器（环境限制）；cfg_attr 门控在 Windows 上为 no-op，语义等价改写双平台一致，交 Windows CI 验证 |

## 改动分类（供 pi 复核）

| 类别 | 内容 |
|------|------|
| 全平台真死代码删除 | `session_attach::build_attached_chats_context` 包装、`connect::busy_process_ids_for_warm_reuse` 方法（无生产无测试引用）、`stream::journal_has_assistant_body`、`PrewarmedProcess.model_id/backend`、`ParkedAgent.sandbox_profile` 及级联（`AcpClient::sandbox_profile()` getter + 字段）、`PetHitChrome.window_w/window_h` |
| cfg_attr(not(windows)) 门控（Windows 生产有调用，保跨平台单测） | `win_taskbar_overlay` 模块级、wsl_backend 四符号、os_theme 两符号、tray_i18n::windows_langid_to_tag、session_api shim 四件套 |
| cfg_attr(not(test)) 门控（生产孤儿但测试覆盖的纯函数） | warm-reuse 三自由函数、proxy::decision_from、remote_im/i18n::normalize_lang、side_browser_blob::unique_download_path、voice_stt::SttErrorCtx、compact wrapper、extract_chat_session_ids |
| 机械 style | needless return/ref/clone、collapsible if、identical blocks 合并、is_multiple_of、contains()、from_ref、let-else→?、too_many_arguments allow ×7（Tauri command 按仓库惯例）、assertions_on_constants allow ×4（const 规格护栏测试）、可见性对齐（PetHitChrome、ToolIdentity pub(crate)） |

## 待办

- [ ] pi 补审 → 回填结论
- [ ] `gh pr ready`
- [ ] CI 绿后交接维护者合并
