/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const { mcpIconResolve, isDesktopHost } = vi.hoisted(() => ({
  mcpIconResolve: vi.fn(),
  isDesktopHost: vi.fn(() => true),
}));

vi.mock("@/lib/api", () => ({ mcpIconResolve }));
vi.mock("@/lib/api/host", () => ({ isDesktopHost }));

import { McpServerIcon } from "./McpServerIcon";
import { resetMcpIconCacheForTests } from "@/lib/mcpIcon";

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

describe("McpServerIcon", () => {
  it("renders the vendor icon once resolved", async () => {
    mcpIconResolve.mockResolvedValue(ICON);

    const { container } = render(
      <McpServerIcon name="context7" target="https://mcp.context7.com/mcp" />,
    );

    await waitFor(() => {
      expect(container.querySelector("img")).toHaveAttribute("src", ICON.dataUrl);
    });
    expect(container.querySelector("img")).toHaveAttribute("alt", "");
  });

  it("keeps the monogram while loading", () => {
    mcpIconResolve.mockReturnValue(new Promise(() => {}));

    const { container } = render(
      <McpServerIcon name="linear" target="https://linear.app/mcp" />,
    );

    expect(container.querySelector(".ext-ref-row__icon-mono")).toHaveTextContent(
      "L",
    );
    expect(container.querySelector("img")).toBeNull();
  });

  it("falls back to the monogram for local servers", () => {
    const { container } = render(<McpServerIcon name="files" target="npx fs-mcp" />);

    expect(container.querySelector(".ext-ref-row__icon-mono")).toHaveTextContent(
      "F",
    );
    expect(mcpIconResolve).not.toHaveBeenCalled();
  });

  it("keeps the monogram when the host command fails", async () => {
    mcpIconResolve.mockRejectedValue(new Error("boom"));

    const { container } = render(
      <McpServerIcon name="github" target="https://api.githubcopilot.com/mcp" />,
    );

    await waitFor(() => expect(mcpIconResolve).toHaveBeenCalled());
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector(".ext-ref-row__icon-mono")).toHaveTextContent(
      "G",
    );
  });
});
