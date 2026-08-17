/**
 * Strip terminal color / cursor sequences from CLI and MCP dumps.
 * Also removes leftover SGR like `[39m` after the ESC byte was dropped
 * (common on Windows / electron-builder / pnpm color output).
 *
 * Fast-path: skip the regex chain when the string has no ESC/CSI and no
 * leftover `[39m`-style SGR (hot path for clean tool output).
 */
const ANSI_HINT = /[\u001b\u009b\x1b]|\[(?:\d{1,3};)*\d{1,3}m/;

export function stripAnsi(text: string): string {
  const s = String(text ?? "");
  if (!ANSI_HINT.test(s)) return s;
  return s
    .replace(/\u001b\][\s\S]*?(?:\u0007|\u001b\\)/g, "")
    .replace(/\u001b\[[\d;?]*(?:[ -/]*[@-~])/g, "")
    .replace(/\x1b\[[\d;?]*(?:[ -/]*[@-~])/g, "")
    .replace(/\u009b[\d;?]*(?:[ -/]*[@-~])/g, "")
    .replace(/\u001b[PX^_][\s\S]*?\u001b\\/g, "")
    .replace(/\u001b[@-_]/g, "")
    .replace(/\x1b/g, "")
    .replace(/\[(?:\d{1,3};)*\d{1,3}m/g, "");
}
