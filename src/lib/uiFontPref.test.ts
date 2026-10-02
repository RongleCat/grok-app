import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyUiFontFamily,
  loadUiFontFamily,
  saveUiFontFamily,
} from "./uiFontPref";

function mem() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      m.set(k, v);
    },
    removeItem: (k: string) => {
      m.delete(k);
    },
  };
}

describe("uiFontPref", () => {
  it("persists and applies --font-sans", () => {
    const s = mem();
    saveUiFontFamily("PingFang SC", s);
    expect(loadUiFontFamily(s)).toBe("PingFang SC");
    const props = new Map<string, string>();
    applyUiFontFamily("PingFang SC", {
      style: {
        setProperty: (n, v) => {
          props.set(n, v);
        },
        removeProperty: (n) => {
          props.delete(n);
        },
      },
    });
    expect(props.get("--font-sans")).toContain("PingFang SC");
    applyUiFontFamily("", {
      style: {
        setProperty: (n, v) => {
          props.set(n, v);
        },
        removeProperty: (n) => {
          props.delete(n);
        },
      },
    });
    expect(props.has("--font-sans")).toBe(false);
  });

  it("chat transcript --chat-font follows --font-sans", () => {
    const src = readFileSync(
      join(__dirname, "../components/lobe-chat/lobe-chat.part1.css"),
      "utf8",
    );
    const shellStart = src.indexOf(".lobe-chat {");
    const familyStart = src.indexOf("font-family: var(--chat-font)", shellStart);
    expect(shellStart).toBeGreaterThanOrEqual(0);
    expect(familyStart).toBeGreaterThan(shellStart);
    const shell = src.slice(shellStart, familyStart);
    expect(shell).toMatch(/--chat-font:\s*var\(--font-sans\)\s*;/);
    expect(shell).not.toMatch(/Microsoft YaHei/);
  });
});
