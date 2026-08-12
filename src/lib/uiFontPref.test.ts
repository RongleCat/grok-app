import { describe, expect, it } from "vitest";
import {
  DEFAULT_UI_FONT_STACK,
  UI_FONT_CUSTOM_VALUE,
  UI_FONT_STORAGE_KEY,
  applyUiFont,
  loadUiFontFamily,
  parseUiFontFamily,
  resolveUiFontStack,
  sanitizeFontFamily,
  saveUiFontFamily,
  setUiFontFamily,
  uiFontSelectValue,
  type UiFontStorage,
} from "./uiFontPref";

function memoryStorage(
  initial: Record<string, string> = {},
): UiFontStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem(key) {
      return key in data ? data[key]! : null;
    },
    setItem(key, value) {
      data[key] = value;
    },
  };
}

describe("uiFontPref", () => {
  it("sanitizes and rejects injection-ish characters", () => {
    expect(sanitizeFontFamily(null)).toBe("");
    expect(sanitizeFontFamily('  Inter  ')).toBe("Inter");
    expect(sanitizeFontFamily('Foo"; color: red')).toBe("Foo color: red");
    expect(sanitizeFontFamily("A".repeat(200)).length).toBe(120);
  });

  it("defaults empty family to system stack", () => {
    expect(parseUiFontFamily(null)).toBe("");
    expect(resolveUiFontStack("")).toBe(DEFAULT_UI_FONT_STACK);
    expect(resolveUiFontStack("Inter")).toBe(
      `"Inter", ${DEFAULT_UI_FONT_STACK}`,
    );
  });

  it("persists and reloads after simulated relaunch", () => {
    const storage = memoryStorage();
    expect(loadUiFontFamily(storage)).toBe("");
    saveUiFontFamily("JetBrains Mono", storage);
    expect(storage.data[UI_FONT_STORAGE_KEY]).toBe("JetBrains Mono");
    expect(loadUiFontFamily(storage)).toBe("JetBrains Mono");
  });

  it("applyUiFont sets or removes --font-sans", () => {
    const props = new Map<string, string>();
    const root = {
      style: {
        setProperty(name: string, value: string) {
          props.set(name, value);
        },
        removeProperty(name: string) {
          props.delete(name);
        },
      },
    };
    applyUiFont("Inter", root);
    expect(props.get("--font-sans")).toBe(resolveUiFontStack("Inter"));
    applyUiFont("", root);
    expect(props.has("--font-sans")).toBe(false);
  });

  it("setUiFontFamily saves and applies", () => {
    const storage = memoryStorage();
    const props = new Map<string, string>();
    const root = {
      style: {
        setProperty(name: string, value: string) {
          props.set(name, value);
        },
        removeProperty(name: string) {
          props.delete(name);
        },
      },
    };
    setUiFontFamily("PingFang SC", storage, root);
    expect(storage.data[UI_FONT_STORAGE_KEY]).toBe("PingFang SC");
    expect(props.get("--font-sans")).toContain("PingFang SC");
  });

  it("maps select value for presets vs custom", () => {
    expect(uiFontSelectValue("")).toBe("");
    expect(uiFontSelectValue("Inter")).toBe("Inter");
    expect(uiFontSelectValue("My Weird Font")).toBe(UI_FONT_CUSTOM_VALUE);
  });
});
