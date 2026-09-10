/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useGitDirtyStatus } from "./useGitDirtyStatus";

vi.mock("@/lib/api", () => ({
  isTauri: () => true,
  gitStatus: vi.fn(),
}));

import * as api from "@/lib/api";

const gitStatusMock = vi.mocked(api.gitStatus);

function dirtyFile(path: string) {
  return { path };
}

describe("useGitDirtyStatus", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("summarizes dirty files for the bound project", async () => {
    gitStatusMock.mockResolvedValue({
      available: true,
      files: [dirtyFile("src/a.ts"), dirtyFile("src/b.ts")],
    } as Awaited<ReturnType<typeof api.gitStatus>>);
    const { result } = renderHook(() =>
      useGitDirtyStatus({ projectPath: "/repo", busy: false }),
    );
    await vi.waitFor(() => {
      expect(result.current.gitDirtySummary).not.toBeNull();
    });
    expect(result.current.gitDirtySummary?.count).toBe(2);
    expect(result.current.gitDirtySummary?.label).toContain("2");
  });

  it("clears to null when no project is bound", async () => {
    const { result } = renderHook(() =>
      useGitDirtyStatus({ projectPath: null, busy: false }),
    );
    await vi.waitFor(() => {
      expect(result.current.gitDirtySummary).toBeNull();
    });
    expect(gitStatusMock).not.toHaveBeenCalled();
  });

  it("keeps null on soft-fail (repo missing) instead of erroring", async () => {
    gitStatusMock.mockRejectedValue(new Error("not a repo"));
    const { result } = renderHook(() =>
      useGitDirtyStatus({ projectPath: "/repo", busy: false }),
    );
    await vi.waitFor(() => {
      expect(result.current.gitDirtySummary).toBeNull();
    });
  });

  it("forwards the raw status to onStatus (branch chip patch)", async () => {
    const raw = { available: true, files: [dirtyFile("x.ts")] } as Awaited<
      ReturnType<typeof api.gitStatus>
    >;
    gitStatusMock.mockResolvedValue(raw);
    const onStatus = vi.fn();
    renderHook(() =>
      useGitDirtyStatus({ projectPath: "/repo", busy: false, onStatus }),
    );
    await vi.waitFor(() => {
      expect(onStatus).toHaveBeenCalledWith("/repo", raw);
    });
  });
});
