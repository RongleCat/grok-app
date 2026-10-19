---
name: pointhand
description: Use the PointHand MCP server to see the Windows desktop and work in desktop apps (Paint, Illustrator, Office, settings dialogs) through real mouse and keyboard input. Use when the user asks you to click, type, draw or inspect something in a native Windows app.
---

# PointHand: Windows computer use

PointHand (https://github.com/ayzekhdawy/pointhand) is a Windows computer-use MCP server.
When it is configured as the `pointhand` MCP server, its tools appear as `pointhand__<tool>`
(the exact prefix depends on the client). It works on Windows 10/11 only.

## Workflow

1. **Find the target.** Use `list_apps` / `list_windows`, or `launch_app` if it is not running. Then use `activate_window`.
2. **Look before acting.** Call `get_window_state` (accessibility tree plus screenshot) or `screenshot`.
   Each result carries a `screenshotId` and a screen origin. Pointer actions (`click`, `drag`, `scroll`)
   bind to the latest `screenshotId` of that window, so take a fresh one after the UI changes.
3. **Prefer semantic actions.** Use `set_value` and `perform_secondary_action` on accessibility elements when
   they exist. Fall back to coordinates (`click`, `move`, `drag`) only when they don't.
4. **Text and keys.** Use `type_text` for short input, `paste` for long or formatted text (`format`: `text`, `md` or `html`),
   and `press_key` for chords (e.g. `ctrl+s`).
5. **Drawing.** `draw` takes freehand strokes, `draw_shape` geometric shapes, and `batch` a sequence of actions in a single call.
6. **Verify.** Take another `get_window_state` or `screenshot` and confirm the result before reporting success.

## Safety rules

- The user can press **Escape** at any time. It stops all further input until the server restarts.
  If a tool reports that the guard is stopped (`guard_status`), stop and tell the user. Do not loop.
- If something goes wrong mid-action, call `emergency_stop`.
- A refusal that names a covering window means the point is under another app. Retry once with the
  returned `screenshotId`; if it is still covered, ask the user.
- Only drive the apps the user asked for. `POINTHAND_ALLOW` limits which executables receive input.
- Never type passwords, payment data or secrets unless the user explicitly asks in this session.
- Elevated (admin) windows and the secure desktop (UAC, lock screen) can reject input. Report it instead of retrying.

## Setup (for the user)

```toml
# ~/.grok/config.toml
[mcp_servers.pointhand]
command = "node"
args = ["C:/Tools/PointHand/client/dist/index.js"]

[mcp_servers.pointhand.env]
POINTHAND_ALLOW = "mspaint.exe"
```

Or, in the app: Settings → Extensions → MCP → Add server → **Fill in PointHand**.
