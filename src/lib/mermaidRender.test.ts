/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const renderMock = vi.fn(async () => ({
  svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>ok</text></svg>',
}));
const initializeMock = vi.fn();

vi.mock("mermaid", () => ({
  default: {
    initialize: initializeMock,
    render: renderMock,
  },
}));

describe("mermaidRender", () => {
  beforeEach(() => {
    renderMock.mockClear();
    initializeMock.mockClear();
    document.documentElement.removeAttribute("data-theme");
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("accepts mermaid fence language tags case-insensitively", async () => {
    const { isMermaidLanguage } = await import("./mermaidRender");
    expect(isMermaidLanguage("mermaid")).toBe(true);
    expect(isMermaidLanguage("Mermaid")).toBe(true);
    expect(isMermaidLanguage("language-mermaid")).toBe(true);
    expect(isMermaidLanguage("ts")).toBe(false);
    expect(isMermaidLanguage(undefined)).toBe(false);
  });

  it("reads light/dark from html data-theme and defaults to dark", async () => {
    const { documentThemeMode } = await import("./mermaidRender");
    expect(documentThemeMode()).toBe("dark");
    document.documentElement.setAttribute("data-theme", "light");
    expect(documentThemeMode()).toBe("light");
    document.documentElement.setAttribute("data-theme", "dark");
    expect(documentThemeMode()).toBe("dark");
  });

  it("returns an svg string for a simple flowchart", async () => {
    const { renderMermaidSvg } = await import("./mermaidRender");
    const svg = await renderMermaidSvg("flowchart LR\n  A-->B", "dark");
    expect(svg).toMatch(/<svg[\s>]/i);
    expect(initializeMock).toHaveBeenCalled();
    expect(renderMock).toHaveBeenCalled();
    const call = renderMock.mock.calls[0] as unknown as [string, string];
    expect(call[1]).toContain("flowchart LR");
  });

  it("rejects empty source", async () => {
    const { renderMermaidSvg } = await import("./mermaidRender");
    await expect(renderMermaidSvg("   ", "dark")).rejects.toThrow(/empty/i);
    expect(renderMock).not.toHaveBeenCalled();
  });
});
