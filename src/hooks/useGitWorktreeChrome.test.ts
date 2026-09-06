/**
 * @vitest-environment jsdom
 *
 * Create / ship / GC verbs live in this hook. Host only supplies project bind
 * and session open. List refresh is a no-op off Tauri unless isTauri is mocked.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { createT } from "@/i18n";
import type { Project } from "@/lib/app/sidebarModels";
import * as api from "@/lib/api";
import {
  createGitWorktreeChromeHost,
  useGitWorktreeChrome,
} from "./useGitWorktreeChrome";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    isTauri: vi.fn(() => false),
    gitWorktreeGc: vi.fn(),
    gitWorktreesList: vi.fn(),
  };
});

const PROJECT: Project = {
  id: "p1",
  name: "app",
  path: "/Users/me/app",
  trusted: true,
  pathOk: true,
};

function setup(hostPatch?: Partial<ReturnType<typeof createGitWorktreeChromeHost>>) {
  const host = createGitWorktreeChromeHost();
  host.tr = createT("en");
  host.activeProject = PROJECT;
  host.showToast = vi.fn();
  Object.assign(host, hostPatch);
  const hostRef = { current: host };
  const hook = renderHook(() =>
    useGitWorktreeChrome({
      hostRef,
      projectPath: host.activeProject?.path ?? null,
    }),
  );
  return { ...hook, host };
}

describe("useGitWorktreeChrome", () => {
  beforeEach(() => {
    vi.mocked(api.isTauri).mockReturnValue(false);
    vi.mocked(api.gitWorktreeGc).mockReset();
    vi.mocked(api.gitWorktreesList).mockReset();
  });

  it("openCreate resets the form and opens the dialog", () => {
    const { result } = setup();
    act(() => {
      result.current.openWorktreeCreate();
    });
    expect(result.current.worktreeChrome.create.open).toBe(true);
    expect(result.current.worktreeChrome.create.name).toBe("");
    expect(result.current.worktreeChrome.create.startChat).toBe(false);
    expect(result.current.worktreeChrome.create.layout).toBe("cli");
    act(() => {
      result.current.worktreeChrome.create.setName("feat-x");
    });
    expect(result.current.worktreeChrome.create.previewPath).toContain(
      "feat-x",
    );
    expect(result.current.worktreeChrome.create.previewPath).toMatch(
      /\.grok\/worktrees\//,
    );
  });

  it("openCreate({ startNewChat: true }) marks startChat", () => {
    const { result } = setup();
    act(() => {
      result.current.openWorktreeCreate({ startNewChat: true });
    });
    expect(result.current.worktreeChrome.create.startChat).toBe(true);
  });

  it("openShipFlow toasts when no project is bound", () => {
    const { result, host } = setup({ activeProject: null });
    act(() => {
      result.current.openShipFlow();
    });
    expect(result.current.worktreeChrome.ship.open).toBe(false);
    expect(host.showToast).toHaveBeenCalled();
  });

  it("closeShip is a no-op while ship is closed", () => {
    const { result } = setup();
    act(() => {
      result.current.worktreeChrome.ship.close();
    });
    expect(result.current.worktreeChrome.ship.open).toBe(false);
  });

  it("submit GC runs non-dry-run prune then closes", async () => {
    vi.mocked(api.isTauri).mockReturnValue(true);
    vi.mocked(api.gitWorktreeGc).mockResolvedValue({
      dryRun: false,
      prunedCount: 2,
      prunable: [],
      output: "",
    });
    vi.mocked(api.gitWorktreesList).mockResolvedValue({
      available: true,
      worktrees: [],
    });
    const { result, host } = setup();
    act(() => {
      result.current.openWorktreeGc();
      result.current.worktreeChrome.gc.setForce(true);
    });
    await act(async () => {
      await result.current.worktreeChrome.gc.submit();
    });
    expect(api.gitWorktreeGc).toHaveBeenCalledWith({
      projectPath: PROJECT.path,
      dryRun: false,
      force: true,
    });
    expect(host.showToast).toHaveBeenCalled();
    expect(result.current.worktreeChrome.gc.open).toBe(false);
  });
});