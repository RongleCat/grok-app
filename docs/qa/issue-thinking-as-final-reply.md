Suggested labels: `bug` / `priority:p1` / `area:session`

### Describe the bug

Sometimes when a turn finishes thinking, the real answer is already in the session, but the chat still shows the thinking text as the final reply. Leave the session and open it again and the answer is there, folded correctly.

This is the same family as #697 (late body missing until remount). That fix covered empty thinking-only / tool-only bubbles. This path is different: live `segments` stay thought-only (or thought leaked into `content`) while the answer already sits on the message field / journal. Paint uses segments, so CoT looks like the reply until remount rebuilds from disk.

**中文：** 思考结束了，最终回复其实已经有了，界面却把刚才的思考过程当成最终回复。退出会话再点进来就正常。#697 修过「空泡不画正文」，这条是直播时间线还停在思考上。

### Steps to reproduce

1. Open Grok App 0.2.29 (or current `main`).
2. Send a prompt that thinks for a while, then writes a real answer (high reasoning, optional tools).
3. Wait until thinking ends. Do not switch sessions.
4. If the bubble still shows the reasoning as the reply, switch to another session and back.

Intermittent. Easier on long thinking turns where the body lands around the same time Host goes `ready`.

### Expected behavior

When thinking ends, the answer should paint in that bubble. Thinking collapses to “Thought for Ns”. Switching sessions should not be required.

**中文：** 思考一结束，正文应出现在同一条气泡里。思考折成「思考了 Ns」。不用切走再切回来。

### App version

0.2.29 (also current `main`)

### Grok Build CLI version (if known)

n/a (UI projection)

### OS

Windows / macOS / Linux (not OS-specific)
