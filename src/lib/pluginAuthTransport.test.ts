import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const bootstrap = readFileSync(new URL("../../src-tauri/src/plugin_auth_stdin.mjs", import.meta.url), "utf8");
const fixtureRoot = mkdtempSync(join(tmpdir(), "grok-auth-transport-test-"));
const fixture = join(fixtureRoot, "plugin with spaces.mjs");
writeFileSync(fixture, `
import { execFileSync } from "node:child_process";
const commandLine = process.platform === "win32"
  ? execFileSync("powershell.exe", ["-NoProfile", "-Command",
      '(Get-CimInstance Win32_Process -Filter "ProcessId=' + process.pid + '").CommandLine'],
      { encoding: "utf8", windowsHide: true }).trim()
  : null;
console.log(JSON.stringify({ args: process.argv.slice(2), commandLine }));
`, "utf8");
afterAll(() => rmSync(fixtureRoot, { recursive: true, force: true }));

describe("plugin auth private pipe on the real Node process", () => {
  it("preserves CLI compatibility while secrets are absent from the OS command line", () => {
    const args = ["login", "--tokens", "--api-key", "SIMULATED-KEY-987654321",
      "--api-secret", "SIMULATED-SECRET-中文-\"-+", "--access-token", "SIMULATED-TOKEN-123456789"];
    const out = execFileSync(process.execPath, ["--input-type=module", "--eval", bootstrap, fixture], {
      input: JSON.stringify(args), encoding: "utf8", timeout: 20000, windowsHide: true,
    });
    const result = JSON.parse(out);
    expect(result.args).toEqual(args);
    if (process.platform === "win32") {
      expect(result.commandLine).toContain("--input-type=module");
      expect(result.commandLine).not.toContain("SIMULATED-");
      expect(result.commandLine).not.toContain("--api-key");
    }
  }, 25000);

  it("rejects malformed input without repeating any payload in the error", () => {
    const result = spawnSync(process.execPath, ["--input-type=module", "--eval", bootstrap, fixture], {
      input: "{INVALID_SYNTHETIC_SECRET", encoding: "utf8", timeout: 10000, windowsHide: true,
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Invalid plugin auth input");
    expect(result.stderr).not.toContain("INVALID_SYNTHETIC_SECRET");
  });

  it("limits private input before importing the plugin", () => {
    const result = spawnSync(process.execPath, ["--input-type=module", "--eval", bootstrap, fixture], {
      input: JSON.stringify(["X".repeat(70000)]), encoding: "utf8", timeout: 10000, windowsHide: true,
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Plugin auth input is too large");
    expect(result.stdout).toBe("");
  });
});
