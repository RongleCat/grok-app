/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@/test/jsdomStubs";
import type { SessionFileChange } from "@/lib/sessionChanges";
import { FilesWorkspace } from "./FilesWorkspace";

const apiMocks = vi.hoisted(() => ({
  fsListDir: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  isTauri: () => true,
  fsListDir: apiMocks.fsListDir,
  settingsGet: vi.fn(),
  settingsSet: vi.fn(),
}));

vi.mock("@/components/OpenLocationButton", () => ({
  OpenLocationButton: () => null,
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tip: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@/components/resource-viewer/useResourceFileTabs", () => ({
  useResourceFileTabs: () => ({
    activeTab: null,
    openFile: vi.fn(),
    openAbsoluteFile: vi.fn(),
    updateActiveDraft: vi.fn(),
    saveActiveFile: vi.fn(),
    revertActiveDraft: vi.fn(),
    toggleActiveEditMode: vi.fn(),
    filesTabsEmpty: null,
    dirtyPaths: [],
    closeByPath: vi.fn(() => true),
    discardTabId: null,
    setDiscardTabId: vi.fn(),
    closeTabForced: vi.fn(),
    conflictTabId: null,
    setConflictTabId: vi.fn(),
    reloadActiveFile: vi.fn(),
  }),
}));

const dir = (name: string) => ({
  name,
  relativePath: name,
  isDir: true,
  size: 0,
  ext: "",
});

const file = (path: string) => ({
  name: path.split("/").at(-1) || path,
  relativePath: path,
  isDir: false,
  size: 1,
  ext: "ts",
});

const change = (
  path: string,
  updatedAt: string,
  status = "completed",
  toolCallId = `call:${path}`,
): SessionFileChange => ({
  path,
  name: path.split("/").at(-1) || path,
  toolKind: "write",
  status,
  updatedAt,
  toolCallId,
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  apiMocks.fsListDir.mockReset();
});

describe("FilesWorkspace session-change refresh", () => {
  it("refreshes once per path set, catches up after hidden, and preserves expanded children on failure", async () => {
    let phase = 0;
    apiMocks.fsListDir.mockImplementation(
      async (_projectPath: string, relativePath: string) => {
        if (!relativePath) {
          return [dir("src"), ...(phase > 0 ? [file("README.md")] : [])];
        }
        if (relativePath !== "src") return [];
        if (phase === 3) throw new Error("nested read failed");
        return [
          file("src/old.ts"),
          ...(phase > 0 ? [file("src/fresh.ts")] : []),
          ...(phase > 1 ? [file("src/hidden.ts")] : []),
        ];
      },
    );

    const props = {
      locale: "en",
      projectPath: "/repo",
      projectName: "repo",
      treeVisible: true,
      onTreeVisibleChange: vi.fn(),
      paneActive: true,
      sessionChanges: [] as SessionFileChange[],
    };
    const view = render(<FilesWorkspace {...props} />);

    const src = await screen.findByText("src");
    await userEvent.click(src.closest("button")!);
    expect(await screen.findByText("old.ts")).toBeInTheDocument();
    expect(apiMocks.fsListDir).toHaveBeenCalledTimes(2);

    phase = 1;
    view.rerender(
      <FilesWorkspace
        {...props}
        sessionChanges={[
          change(
            "src/fresh.ts",
            "2026-08-25T01:00:00Z",
            "in_progress",
            "call:fresh",
          ),
        ]}
      />,
    );
    await waitFor(() => expect(apiMocks.fsListDir).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("fresh.ts")).not.toBeInTheDocument();

    view.rerender(
      <FilesWorkspace
        {...props}
        sessionChanges={[
          change(
            "src/fresh.ts",
            "2026-08-25T01:00:01Z",
            "completed",
            "call:fresh",
          ),
        ]}
      />,
    );
    expect(await screen.findByText("fresh.ts")).toBeInTheDocument();
    expect(apiMocks.fsListDir).toHaveBeenCalledTimes(4);

    view.rerender(
      <FilesWorkspace
        {...props}
        sessionChanges={[
          change(
            "src/fresh.ts",
            "2026-08-25T02:00:00Z",
            "completed",
            "call:fresh",
          ),
        ]}
      />,
    );
    await waitFor(() => expect(apiMocks.fsListDir).toHaveBeenCalledTimes(4));

    phase = 2;
    view.rerender(
      <FilesWorkspace
        {...props}
        paneActive={false}
        sessionChanges={[change("src/hidden.ts", "2026-08-25T03:00:00Z")]}
      />,
    );
    await waitFor(() => expect(apiMocks.fsListDir).toHaveBeenCalledTimes(4));

    view.rerender(
      <FilesWorkspace
        {...props}
        sessionChanges={[change("src/hidden.ts", "2026-08-25T03:00:00Z")]}
      />,
    );
    expect(await screen.findByText("hidden.ts")).toBeInTheDocument();
    expect(apiMocks.fsListDir).toHaveBeenCalledTimes(6);

    phase = 3;
    view.rerender(
      <FilesWorkspace
        {...props}
        sessionChanges={[change("src/failed.ts", "2026-08-25T04:00:00Z")]}
      />,
    );
    await waitFor(() => expect(apiMocks.fsListDir).toHaveBeenCalledTimes(8));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "nested read failed",
    );
    expect(screen.getByText("hidden.ts")).toBeInTheDocument();
  });

  it("discards an older soft refresh when a newer completed revision wins", async () => {
    let resolveStale!: (value: ReturnType<typeof file>[]) => void;
    const staleRead = new Promise<ReturnType<typeof file>[]>((resolve) => {
      resolveStale = resolve;
    });
    let rootReads = 0;
    apiMocks.fsListDir.mockImplementation(
      async (_projectPath: string, relativePath: string) => {
        if (relativePath) return [];
        rootReads += 1;
        if (rootReads === 1) return [file("base.ts")];
        if (rootReads === 2) return staleRead;
        return [file("latest.ts")];
      },
    );

    const props = {
      locale: "en",
      projectPath: "/repo",
      projectName: "repo",
      treeVisible: true,
      onTreeVisibleChange: vi.fn(),
      paneActive: true,
      sessionChanges: [] as SessionFileChange[],
    };
    const view = render(<FilesWorkspace {...props} />);
    expect(await screen.findByText("base.ts")).toBeInTheDocument();

    view.rerender(
      <FilesWorkspace
        {...props}
        sessionChanges={[
          change("same.ts", "2026-08-25T05:00:00Z", "completed", "call:1"),
        ]}
      />,
    );
    await waitFor(() => expect(apiMocks.fsListDir).toHaveBeenCalledTimes(2));

    view.rerender(
      <FilesWorkspace
        {...props}
        sessionChanges={[
          change("same.ts", "2026-08-25T05:00:01Z", "completed", "call:2"),
        ]}
      />,
    );
    expect(await screen.findByText("latest.ts")).toBeInTheDocument();

    await act(async () => {
      resolveStale([file("stale.ts")]);
      await staleRead;
    });
    await waitFor(() => {
      expect(screen.getByText("latest.ts")).toBeInTheDocument();
      expect(screen.queryByText("stale.ts")).not.toBeInTheDocument();
    });
  });
});
