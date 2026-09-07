/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { createT } from "@/i18n";
import * as api from "@/lib/api";
import {
  createMcpDoctorChromeHost,
  useMcpDoctorChrome,
} from "./useMcpDoctorChrome";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    isTauri: vi.fn(() => false),
    inspectMcp: vi.fn(),
    mcpDoctor: vi.fn(),
  };
});

function setup(projectPath: string | null = "/repo") {
  const host = createMcpDoctorChromeHost();
  host.tr = createT("en");
  const hostRef = { current: host };
  const hook = renderHook(() =>
    useMcpDoctorChrome({ hostRef, projectPath }),
  );
  return { ...hook, host };
}

describe("useMcpDoctorChrome", () => {
  beforeEach(() => {
    vi.mocked(api.isTauri).mockReturnValue(false);
    vi.mocked(api.inspectMcp).mockReset();
    vi.mocked(api.mcpDoctor).mockReset();
  });

  it("opens the modal and loads the inspect list", async () => {
    vi.mocked(api.inspectMcp).mockResolvedValue({
      servers: [{ name: "fs" } as api.McpDto],
    });
    const { result } = setup();
    await act(async () => {
      await result.current.openMcpModal();
    });
    expect(result.current.showMcpModal).toBe(true);
    expect(result.current.mcpServers.map((s) => s.name)).toEqual(["fs"]);
  });

  it("soft-fails doctor off Tauri without calling Host", async () => {
    const { result } = setup();
    let out: { report: unknown; error: string | null } = {
      report: null,
      error: null,
    };
    await act(async () => {
      out = await result.current.runMcpDoctor("fs");
    });
    expect(api.mcpDoctor).not.toHaveBeenCalled();
    expect(out.report).toBeNull();
    expect(out.error).toBeTruthy();
    expect(result.current.mcpDoctorError).toBe(out.error);
  });

  it("stores a doctor report from Host", async () => {
    vi.mocked(api.isTauri).mockReturnValue(true);
    vi.mocked(api.mcpDoctor).mockResolvedValue({
      ok: true,
      servers: [],
      issues: [],
    });
    const { result } = setup();
    await act(async () => {
      await result.current.runMcpDoctor("fs");
    });
    expect(result.current.mcpDoctorFocus).toBe("fs");
    expect(result.current.mcpDoctorReport?.ok).toBe(true);
    expect(result.current.mcpDoctorError).toBeNull();
  });
});
