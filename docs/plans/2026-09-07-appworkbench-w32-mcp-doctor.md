# AppWorkbench 继续拆解 — WP-W32 MCP doctor

**日期**：2026-09-07  
**基线**：`origin/main` @ `0a484d1a`（W31 #1058）  
**执行位置**：分支 `refactor/appworkbench-w32-mcp-doctor`

MCP 检查列表 + doctor 报告仍堆在 host。弹层 JSX 已在 `WorkbenchSessionModals`。本刀抽 state / inspect / `mcpDoctor()`。

新建 `useMcpDoctorChrome`：`showMcpModal`、servers/error/loading、doctor report/error/loading/focus、`refreshMcpModal` / `openMcpModal` / `runMcpDoctor`。

`tr` 晚绑。`projectPath` 入参。下一步 W33 setup / boot。
