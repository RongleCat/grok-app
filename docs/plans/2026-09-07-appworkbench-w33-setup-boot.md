# AppWorkbench 继续拆解 — WP-W33 setup / boot gate

**日期**：2026-09-07  
**基线**：`origin/main` @ `1cd77860`（W32 #1060）

`appGate` / bootDetect* / `setupCliSeed` / `setSetup` 仍在 host。完整 boot hydration（projects/sessions/models）留 host——那是整棵 workbench 注水，不是闸门知识。抽闸门状态 + 就绪后通知权限 + retry/skip 动词。

新建 `useSetupBootGate`。不抽 `sessionChangesById` / git dirty。
