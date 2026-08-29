import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  path.join(fileURLToPath(new URL(".", import.meta.url)), "lobe-chat.part1.css"),
  "utf8",
);

describe("message action visibility CSS", () => {
  it("shows the toolbar by default and hides only in hover mode", () => {
    const base = css.match(/^\.lobe-chat-item__actions\s*\{([^}]+)\}/m);
    expect(base?.[1]).toBeTruthy();
    expect(base?.[1]).not.toMatch(/opacity\s*:\s*0/);
    expect(css).toMatch(
      /html\[data-msg-actions="hover"\]\s+\.lobe-chat-item__actions/,
    );
    expect(css).toMatch(
      /html\[data-msg-actions="hover"\][\s\S]*?opacity:\s*0/,
    );
    expect(css).not.toMatch(/html\[data-msg-actions="always"\]/);
  });
});
