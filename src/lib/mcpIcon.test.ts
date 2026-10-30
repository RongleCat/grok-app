import { beforeEach, describe, expect, it, vi } from "vitest";

const { mcpIconResolve, isDesktopHost } = vi.hoisted(() => ({
  mcpIconResolve: vi.fn(),
  isDesktopHost: vi.fn(() => true),
}));

vi.mock("@/lib/api", () => ({ mcpIconResolve }));
vi.mock("@/lib/api/host", () => ({ isDesktopHost }));

import {
  MCP_MONOGRAM_TONES,
  loadMcpIcon,
  mcpIconRequestKey,
  mcpIconTargetUrl,
  mcpMonogramLabel,
  mcpMonogramTone,
  normalizeMcpIconResult,
  peekMcpIcon,
  resetMcpIconCacheForTests,
} from "./mcpIcon";

const ICON = {
  dataUrl: "data:image/png;base64,AAAA",
  domain: "context7.com",
  source: "site" as const,
  fromCache: false,
};

beforeEach(() => {
  resetMcpIconCacheForTests();
  mcpIconResolve.mockReset();
  isDesktopHost.mockReset();
  isDesktopHost.mockReturnValue(true);
});

describe("mcpIconTargetUrl", () => {
  it("accepts https targets and keeps their path", () => {
    expect(mcpIconTargetUrl("https://mcp.context7.com/mcp")).toBe(
      "https://mcp.context7.com/mcp",
    );
  });

  it("rejects non-https, userinfo, and command targets", () => {
    expect(mcpIconTargetUrl("http://mcp.context7.com/mcp")).toBeNull();
    expect(mcpIconTargetUrl("https://user:pass@example.com/mcp")).toBeNull();
    expect(mcpIconTargetUrl("npx -y @linear/mcp")).toBeNull();
    expect(mcpIconTargetUrl("")).toBeNull();
  });
});

describe("mcpIconRequestKey", () => {
  it("keys by host so different paths share one lookup", () => {
    expect(mcpIconRequestKey("https://MCP.Context7.com/a")).toBe(
      "mcp.context7.com",
    );
    expect(mcpIconRequestKey("https://mcp.context7.com/b")).toBe(
      "mcp.context7.com",
    );
  });

  it("separates two servers on the same host", () => {
    expect(mcpIconRequestKey("https://mcp.example.com/a", "alpha")).not.toBe(
      mcpIconRequestKey("https://mcp.example.com/b", "beta"),
    );
    expect(mcpIconRequestKey("https://mcp.example.com/a", "Alpha")).toBe(
      mcpIconRequestKey("https://mcp.example.com/b", "alpha"),
    );
  });

  it("returns an empty key for unusable targets", () => {
    expect(mcpIconRequestKey("stdio://server")).toBe("");
  });
});

describe("mcpMonogramLabel", () => {
  it("uses the first letter or digit", () => {
    expect(mcpMonogramLabel("context7")).toBe("C");
    expect(mcpMonogramLabel("  123-server")).toBe("1");
    expect(mcpMonogramLabel("!@#linear")).toBe("L");
  });

  it("falls back to a question mark when no letter exists", () => {
    expect(mcpMonogramLabel("!!!")).toBe("?");
    expect(mcpMonogramLabel("")).toBe("?");
  });
});

describe("mcpMonogramTone", () => {
  it("is deterministic and stays in range", () => {
    const first = mcpMonogramTone("Context7");
    expect(mcpMonogramTone("context7")).toBe(first);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThan(MCP_MONOGRAM_TONES);
  });
});

describe("normalizeMcpIconResult", () => {
  it("keeps a valid payload, including a server-declared icon", () => {
    expect(normalizeMcpIconResult(ICON)).toEqual(ICON);
    expect(normalizeMcpIconResult({ ...ICON, source: "server" })).toEqual({
      ...ICON,
      source: "server",
    });
  });

  it("drops unknown sources and non-image data URLs", () => {
    expect(normalizeMcpIconResult({ ...ICON, source: "google" })).toBeNull();
    expect(
      normalizeMcpIconResult({ ...ICON, dataUrl: "https://evil.example/x.png" }),
    ).toEqual({ ...ICON, dataUrl: null, source: "none" });
  });

  it("downgrades a missing data URL to none", () => {
    expect(normalizeMcpIconResult({ ...ICON, dataUrl: null })).toEqual({
      ...ICON,
      dataUrl: null,
      source: "none",
    });
  });
});

describe("loadMcpIcon", () => {
  it("dedupes concurrent lookups for the same host", async () => {
    mcpIconResolve.mockResolvedValue(ICON);

    const [a, b] = await Promise.all([
      loadMcpIcon("https://mcp.context7.com/a"),
      loadMcpIcon("https://mcp.context7.com/b"),
    ]);

    expect(mcpIconResolve).toHaveBeenCalledTimes(1);
    expect(a).toEqual(ICON);
    expect(b).toEqual(ICON);
    expect(peekMcpIcon("https://mcp.context7.com/c")).toEqual(ICON);
  });

  it("returns null and does not cache when the host reports none", async () => {
    mcpIconResolve.mockResolvedValue({ ...ICON, dataUrl: null, source: "none" });

    await expect(loadMcpIcon("https://mcp.context7.com/mcp")).resolves.toBeNull();
    expect(peekMcpIcon("https://mcp.context7.com/mcp")).toBeNull();
  });

  it("swallows command failures", async () => {
    mcpIconResolve.mockRejectedValue(new Error("boom"));

    await expect(loadMcpIcon("https://linear.app/mcp")).resolves.toBeNull();
  });

  it("caps in-flight lookups at four", async () => {
    const resolvers: Array<(value: unknown) => void> = [];
    mcpIconResolve.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        }),
    );

    const tasks = ["a", "b", "c", "d", "e"].map((host) =>
      loadMcpIcon(`https://${host}.example.com/mcp`),
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(mcpIconResolve).toHaveBeenCalledTimes(4);

    resolvers[0]({ ...ICON, dataUrl: null, source: "none" });
    await tasks[0];
    await Promise.resolve();
    expect(mcpIconResolve).toHaveBeenCalledTimes(5);

    resolvers.slice(1).forEach((resolve) =>
      resolve({ ...ICON, dataUrl: null, source: "none" }),
    );
    await Promise.all(tasks);
  });

  it("does not call the host outside the desktop app", async () => {
    isDesktopHost.mockReturnValue(false);

    await expect(loadMcpIcon("https://linear.app/mcp")).resolves.toBeNull();
    expect(mcpIconResolve).not.toHaveBeenCalled();
  });

  it("skips local command targets", async () => {
    await expect(loadMcpIcon("npx -y @linear/mcp")).resolves.toBeNull();
    expect(mcpIconResolve).not.toHaveBeenCalled();
  });
});
