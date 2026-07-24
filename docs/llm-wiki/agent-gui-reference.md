# Agent GUI 对标纪要

本地参考克隆：`.refs/aider-desk`（gitignore，勿提交）。

## 借鉴来源

| 来源 | 借鉴点 | 落地 |
|------|--------|------|
| **AiderDesk** `ProjectFilesSection` / `FileViewerModal` | 项目文件树 + 读文件预览 + 搜索/刷新 | `ResourceViewer` + `fs_list_dir` / `fs_read_file` |
| **Grok Build 权限文档** | `default` / `acceptEdits` / `dontAsk` / `bypassPermissions` | `PERMISSION_POLICIES` + Host `PermissionPolicy` |
| **产品 sheet UI（参考图）** | 两 chip：模型+努力 / 访问（模式+权限合并）；窄宽压缩为短文案或仅图标 | `ComposerModelMenu` · `ComposerAccessMenu` |
| **OpenHands Canvas / 通用三栏** | 左会话 / 中对话 / 右资源，侧栏可关 | `sidebar--hidden` / `aside--hidden` + 顶栏 icon |
| **会话变更审阅（L06）** | Agent 写/改文件列表 + unified diff / 外开编辑器 | `ResourceViewer` Changes 模式 + `sessionChanges` + 可选 `git_file_diff` |
| **工作区 git 变更** | 项目 `git status` 列表 + 点击看 diff | `git_status` / `git_show_file` + Changes → **Workspace** 段 |
| **Plan 审阅** | 待审阅计划 Markdown 全文 + 批准/修改 | `ResourceViewer` **Plan** 模式 + sticky `PlanStatusBar` |

## 交互约定

1. 左、右栏**彻底关闭**（width 0，无 icon rail）；顶栏 `IconPanel` / `IconFiles` 开关。
2. 右栏 = 当前项目资源查看器（会话项目路径），多格式预览（text/code/md/json/csv/html/image/svg/pdf/audio/video）。
3. Composer 模型区合并为 ⚡ 菜单：模型 / 推理强度 / 授权模式；高级里放会话 mode。
4. **Changes（会话 + 工作区）**：右栏 chrome 的 diff 图标 + 侧栏 **Files | Changes** 切换。  
   - **Session**：`session://tool` 中 write/edit 类工具（`isEditToolKind`）与历史 `tool_step` 消息。  
   - **Workspace**：项目路径 `git_status`（soft-fail：无 git / 非仓库）；刷新按钮；分支名提示。  
   - 点击条目：优先工具 payload 的 before/after → 本地 unified diff；否则 `git_file_diff`；再否则 `git_show_file`（HEAD）+ 工作区内容；再否则当前文件内容。  
   - 行操作：打开编辑器 / Reveal / 复制路径（**不做**危险 discard，避免误清工作区）。  
   - 纯 helper：`src/lib/sessionChanges.ts`、`src/lib/workspaceGit.ts`。
5. **Plan（资源审阅）**：顶条「在资源中打开」/ `exit_plan_mode` 就绪时自动开右栏 **Plan** 模式。  
   - 正文：`MarkdownBody`（`planContent` 优先，否则 entries 合成 markdown）。  
   - 操作：批准 / 请求修改 / 关闭（与顶条共用 `sessionResolvePlan`）。  
   - 线程内保留紧凑预览卡；主审阅面在资源面板。  
   - helper：`src/lib/planBody.ts`、`PlanReviewPanel`。
