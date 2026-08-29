/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@/test/jsdomStubs";
import type { FileTab } from "@/components/resource-viewer/types";
import { FilesWorkspace } from "./FilesWorkspace";

const tabMocks = vi.hoisted(() => ({
  activeTab: null as FileTab | null,
  activeTabEditable: false,
  saveActiveFile: vi.fn(),
  revertActiveDraft: vi.fn(),
  toggleActiveEditMode: vi.fn(),
  hideToolbarSeen: null as boolean | null,
}));

vi.mock("@/lib/api", () => ({
  isTauri: () => true,
  fsListDir: vi.fn(async () => []),
  settingsGet: vi.fn(),
  settingsSet: vi.fn(),
}));

vi.mock("@/components/OpenLocationButton", () => ({
  OpenLocationButton: () => <span data-testid="files-open-location" />,
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tip: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@/components/resource-viewer/ResourcePreviewBody", () => ({
  ResourcePreviewBody: (props: { hideToolbar?: boolean }) => {
    tabMocks.hideToolbarSeen = !!props.hideToolbar;
    return <div data-testid="preview-body" />;
  },
}));

vi.mock("@/components/resource-viewer/useResourceFileTabs", () => ({
  useResourceFileTabs: () => ({
    activeTab: tabMocks.activeTab,
    activeTabEditable: tabMocks.activeTabEditable,
    openFile: vi.fn(),
    openAbsoluteFile: vi.fn(),
    updateActiveDraft: vi.fn(),
    saveActiveFile: tabMocks.saveActiveFile,
    revertActiveDraft: tabMocks.revertActiveDraft,
    toggleActiveEditMode: tabMocks.toggleActiveEditMode,
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

function codeTab(overrides: Partial<FileTab> = {}): FileTab {
  return {
    id: "tab-1",
    relativePath: "organize_by_type.py",
    name: "organize_by_type.py",
    absolutePath: "/repo/organize_by_type.py",
    preview: {
      kind: "code",
      text: "print(1)\n",
      name: "organize_by_type.py",
      relativePath: "organize_by_type.py",
      absolutePath: "/repo/organize_by_type.py",
      truncated: false,
      error: null,
    } as FileTab["preview"],
    mediaSrc: null,
    error: null,
    loading: false,
    tabKind: "file",
    draftText: "print(1)\n",
    baselineText: "print(1)\n",
    editMode: false,
    saving: false,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  tabMocks.activeTab = null;
  tabMocks.activeTabEditable = false;
  tabMocks.hideToolbarSeen = null;
  tabMocks.saveActiveFile.mockReset();
  tabMocks.revertActiveDraft.mockReset();
  tabMocks.toggleActiveEditMode.mockReset();
});

const baseProps = {
  locale: "en",
  projectPath: "/repo",
  projectName: "repo",
  treeVisible: false,
  onTreeVisibleChange: vi.fn(),
  paneActive: true,
  sessionChanges: [],
};

describe("FilesWorkspace editor chrome", () => {
  it("puts Save in the files toolbar and drops the duplicate filename row", async () => {
    tabMocks.activeTab = codeTab({
      draftText: "print(2)\n",
      baselineText: "print(1)\n",
    });
    tabMocks.activeTabEditable = true;

    render(
      <FilesWorkspace {...baseProps} activePath="organize_by_type.py" />,
    );

    const toolbar = screen.getByTestId("files-toolbar");
    expect(screen.getByTestId("files-editor-save")).toBeInTheDocument();
    expect(screen.getByTestId("files-editor-edit")).toBeInTheDocument();
    expect(toolbar).toHaveTextContent("Save");
    expect(toolbar).toHaveTextContent("Edit");
    expect(toolbar).not.toHaveTextContent("organize_by_type.py");
    expect(tabMocks.hideToolbarSeen).toBe(true);

    await userEvent.click(screen.getByTestId("files-editor-edit"));
    expect(tabMocks.toggleActiveEditMode).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByTestId("files-editor-save"));
    expect(tabMocks.saveActiveFile).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByTestId("files-editor-revert"));
    expect(tabMocks.revertActiveDraft).toHaveBeenCalledTimes(1);
  });

  it("keeps breadcrumbs for non-editable files", () => {
    tabMocks.activeTab = codeTab({
      preview: {
        kind: "image",
        text: null,
        name: "shot.png",
        relativePath: "shot.png",
        absolutePath: "/repo/shot.png",
        truncated: false,
        error: null,
      } as FileTab["preview"],
      relativePath: "shot.png",
      name: "shot.png",
      draftText: null,
      baselineText: null,
    });
    tabMocks.activeTabEditable = false;

    render(<FilesWorkspace {...baseProps} activePath="shot.png" />);

    const toolbar = screen.getByTestId("files-toolbar");
    expect(screen.queryByTestId("files-editor-save")).not.toBeInTheDocument();
    expect(toolbar).toHaveTextContent("shot.png");
    expect(tabMocks.hideToolbarSeen).toBe(false);
  });
});
