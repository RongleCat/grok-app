/**
 * Strip terminal color / cursor sequences from CLI and MCP dumps.
 * Also removes leftover SGR like `[39m` after the ESC byte was dropped
 * (common on Windows / electron-builder / pnpm color output).
 */
export function stripAnsi(text: string): string {
  return String(text ?? "")
    .replace(/\u001b\][\s\S]*?(?:\u0007|\u001b\\)/g, "")
    .replace(/\u001b\[[\d;?]*(?:[ -/]*[@-~])/g, "")
    .replace(/\x1b\[[\d;?]*(?:[ -/]*[@-~])/g, "")
    .replace(/\u009b[\d;?]*(?:[ -/]*[@-~])/g, "")
    .replace(/\u001b[PX^_][\s\S]*?\u001b\\/g, "")
    .replace(/\u001b[@-_]/g, "")
    .replace(/\x1b/g, "")
    .replace(/\[(?:\d{1,3};)*\d{1,3}m/g, "");
}
