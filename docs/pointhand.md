# PointHand: computer use on Windows

[Türkçe](pointhand.tr.md)

<p align="center"><img src="pointhand/logo.png" alt="PointHand logo" width="360"></p>

[PointHand](https://github.com/ayzekhdawy/pointhand) is an open-source (MIT) **Windows computer-use MCP server**.
It lets the Grok agent see the screen and work in desktop apps through real mouse and keyboard input:
it can click, type, scroll, use the clipboard and accessibility actions, take window screenshots, and even
draw in Paint. A TypeScript MCP server (Node.js 20+) talks to a native Rust host. A click-through overlay shows
what PointHand is doing, and **physical Escape stops it at any time**.

| Drawn in Paint by PointHand | Activity overlay |
| :---: | :---: |
| <img src="pointhand/mona-lisa-result.png" alt="Mona Lisa drawn in Microsoft Paint with PointHand mouse strokes" width="220"> | <img src="pointhand/overlay-preview.png" alt="PointHand glass frame, activity label and cursor trail" width="420"> |

*Both images come from the PointHand repository (real output). The diagram below is an illustration.*

<p align="center"><img src="pointhand/architecture.svg" alt="Illustration: Grok App → Grok CLI → PointHand MCP → Rust host → Windows" width="860"></p>

## 1. Install PointHand

1. Download the Windows x64 ZIP and its `.sha256` from [PointHand releases](https://github.com/ayzekhdawy/pointhand/releases).
2. Verify it (`Get-FileHash -Algorithm SHA256 <zip>`), then extract it, e.g. to `C:\Tools\PointHand`.
3. Install [Node.js 20+](https://nodejs.org/).

## 2a. In the app (recommended)

1. Open **Settings → Extensions → MCP → Add server**.
2. Click **Fill in PointHand**. The form is filled with:
   - Name `pointhand`, Command `node`
   - Args `C:/Tools/PointHand/client/dist/index.js`
   - Env `POINTHAND_ALLOW=mspaint.exe`
3. Change the path to your extracted `client/dist/index.js`. Set `POINTHAND_ALLOW` to the comma-separated
   executables PointHand may control (empty = every app). Then press **Add**.
   The running agent restarts, and new chats get the PointHand tools.
4. Optional: click **Install PointHand skill**. This writes the bundled
   [`skills/pointhand/SKILL.md`](../skills/pointhand/SKILL.md) to your user skills folder, so the agent knows the
   look → act → verify workflow and the safety rules. An existing `pointhand` skill is never overwritten.

## 2b. Terminal Grok CLI

Add this to `~/.grok/config.toml`:

```toml
[mcp_servers.pointhand]
command = "node"
args = ["C:/Tools/PointHand/client/dist/index.js"]

[mcp_servers.pointhand.env]
POINTHAND_ALLOW = "mspaint.exe"
```

Then copy the skill: `skills/pointhand/SKILL.md` → `~/.grok/skills/pointhand/SKILL.md`.
Run `grok mcp list` to check that `pointhand` is listed.

## 3. Try it

Open a blank Paint canvas and ask:

> Use PointHand to inspect the Paint window, select a drawing tool and draw a small fish in the center of the canvas.

Good first tasks: fill a desktop form, rename files in Explorer, change a setting, or draw a sketch.
For the full portrait workflow, see the [Mona Lisa tutorial](https://github.com/ayzekhdawy/pointhand/blob/main/examples/mona-lisa/README.md).

## Safety

- PointHand moves your real mouse. Use it in a supervised session.
- **Escape** stops all further input until the server restarts. The agent can also call `emergency_stop`.
- `POINTHAND_ALLOW` is a guardrail, not a sandbox. Elevated windows and UAC prompts can reject input.
- See PointHand's [security policy](https://github.com/ayzekhdawy/pointhand/blob/main/SECURITY.md).

PointHand is currently an **alpha** (v0.2.0-alpha.5, 28 tools) and works on Windows 10/11 only.
