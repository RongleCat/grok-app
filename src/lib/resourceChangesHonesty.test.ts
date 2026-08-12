import { describe, expect, it } from "vitest";
import {
  classifyWorkspaceGitReasonText,
  classifyWorkspaceGitUnavailable,
  countWorkspaceKinds,
  filterEntriesByKind,
  filterWorkspaceByKind,
  normalizeChangesKindFilter,
  presentWorkspaceKindFilters,
  resolveChangesPreviewEmptyState,
  resolveReviewEmptyState,
  resolveSessionSectionEmpty,
  resolveWorkspaceSectionEmpty,
  shouldShowKindFilters,
  workspaceGitUnavailableHintKey,
  workspaceGitUnavailableTitleKey,
} from "./resourceChangesHonesty";
import type { WorkspaceGitFile } from "./workspaceGit";

const sample: WorkspaceGitFile[] = [
  {
    path: "a.ts",
    absolutePath: "/p/a.ts",
    status: " M",
    indexStatus: " ",
    worktreeStatus: "M",
    kind: "modified",
    name: "a.ts",
  },
  {
    path: "b.ts",
    absolutePath: "/p/b.ts",
    status: "??",
    indexStatus: "?",
    worktreeStatus: "?",
    kind: "untracked",
    name: "b.ts",
  },
  {
    path: "c.ts",
    absolutePath: "/p/c.ts",
    status: "A ",
    indexStatus: "A",
    worktreeStatus: " ",
    kind: "added",
    name: "c.ts",
  },
];

describe("classifyWorkspaceGitReasonText", () => {
  it("maps no-repo / no-git phrases", () => {
    expect(classifyWorkspaceGitReasonText("not a git repository")).toBe(
      "no_repo",
    );
    expect(classifyWorkspaceGitReasonText("git not available")).toBe("no_git");
  });

  it("maps load failures", () => {
    expect(classifyWorkspaceGitReasonText("spawn git failed: ENOENT")).toBe(
      "load_error",
    );
    expect(classifyWorkspaceGitReasonText("ipc timeout")).toBe("load_error");
  });

  it("falls back to unavailable", () => {
    expect(classifyWorkspaceGitReasonText("")).toBe("unavailable");
    expect(classifyWorkspaceGitReasonText("weird")).toBe("unavailable");
  });
});

describe("classifyWorkspaceGitUnavailable", () => {
  it("no_project when path empty", () => {
    expect(
      classifyWorkspaceGitUnavailable({
        projectPath: "",
        available: false,
      }),
    ).toBe("no_project");
  });

  it("host_only when not Tauri", () => {
    expect(
      classifyWorkspaceGitUnavailable({
        projectPath: "/p",
        isTauri: false,
        available: false,
      }),
    ).toBe("host_only");
  });

  it("null when available or still loading", () => {
    expect(
      classifyWorkspaceGitUnavailable({
        projectPath: "/p",
        isTauri: true,
        available: true,
      }),
    ).toBeNull();
    expect(
      classifyWorkspaceGitUnavailable({
        projectPath: "/p",
        isTauri: true,
        available: false,
        loading: true,
      }),
    ).toBeNull();
  });

  it("classifies reason when unavailable", () => {
    expect(
      classifyWorkspaceGitUnavailable({
        projectPath: "/p",
        isTauri: true,
        available: false,
        reason: "not a git repository",
      }),
    ).toBe("no_repo");
  });
});

describe("resolveReviewEmptyState", () => {
  it("not_git when non-git and no session rows", () => {
    const s = resolveReviewEmptyState({
      isGitProject: false,
      sessionCount: 0,
      projectPath: "/p",
      loading: false,
      fileCount: 0,
      visibleCount: 0,
    });
    expect(s.kind).toBe("not_git");
    expect(s.titleKey).toBe("side.review.notGit");
  });

  it("load_error over empty when classified", () => {
    const s = resolveReviewEmptyState({
      isGitProject: true,
      sessionCount: 0,
      projectPath: "/p",
      loading: false,
      loadErrorKind: "load_error",
      fileCount: 0,
      visibleCount: 0,
    });
    expect(s.kind).toBe("load_error");
    expect(s.titleKey).toBe("changes.workspace.loadError");
  });

  it("empty vs filter_empty", () => {
    expect(
      resolveReviewEmptyState({
        isGitProject: true,
        sessionCount: 0,
        projectPath: "/p",
        loading: false,
        fileCount: 0,
        visibleCount: 0,
      }).kind,
    ).toBe("empty");
    expect(
      resolveReviewEmptyState({
        isGitProject: true,
        sessionCount: 2,
        projectPath: "/p",
        loading: false,
        fileCount: 2,
        visibleCount: 0,
        hasActiveFilter: true,
      }).kind,
    ).toBe("filter_empty");
  });

  it("ok when visible files exist", () => {
    expect(
      resolveReviewEmptyState({
        isGitProject: true,
        sessionCount: 1,
        projectPath: "/p",
        loading: false,
        fileCount: 1,
        visibleCount: 1,
      }).kind,
    ).toBe("ok");
  });
});

describe("resolveChangesPreviewEmptyState", () => {
  it("prefers no_repo honesty over session-empty copy", () => {
    const s = resolveChangesPreviewEmptyState({
      projectPath: "/p",
      sessionCount: 0,
      workspaceCount: 0,
      workspaceLoading: false,
      workspaceAvailable: false,
      workspaceReason: "not a git repository",
      isTauri: true,
      hasSelection: false,
    });
    expect(s.kind).toBe("no_repo");
    expect(s.titleKey).toBe("changes.workspace.noRepo");
  });

  it("pick when rows exist but nothing selected", () => {
    const s = resolveChangesPreviewEmptyState({
      projectPath: "/p",
      sessionCount: 1,
      workspaceCount: 0,
      workspaceLoading: false,
      workspaceAvailable: true,
      isTauri: true,
      hasSelection: false,
    });
    expect(s.kind).toBe("pick");
  });

  it("ok when selection present", () => {
    expect(
      resolveChangesPreviewEmptyState({
        projectPath: "/p",
        sessionCount: 0,
        workspaceCount: 0,
        workspaceLoading: false,
        workspaceAvailable: true,
        hasSelection: true,
      }).kind,
    ).toBe("ok");
  });
});

describe("section empties + kind filters", () => {
  it("session section distinguishes filter", () => {
    expect(resolveSessionSectionEmpty({ query: "", sessionCount: 0 }).titleKey).toBe(
      "changes.empty",
    );
    expect(
      resolveSessionSectionEmpty({ query: "zzz", sessionCount: 3 }).titleKey,
    ).toBe("changes.filterEmpty");
  });

  it("workspace section filter empty when kind chips leave zero", () => {
    const s = resolveWorkspaceSectionEmpty({
      query: "",
      kindFilter: "deleted",
      workspaceCount: 3,
      filteredCount: 0,
    });
    expect(s.titleKey).toBe("changes.filterEmpty");
  });

  it("counts kinds and filters", () => {
    const counts = countWorkspaceKinds(sample);
    expect(counts.modified).toBe(1);
    expect(counts.untracked).toBe(1);
    expect(counts.added).toBe(1);
    expect(shouldShowKindFilters(counts)).toBe(true);
    expect(presentWorkspaceKindFilters(counts, "all")).toEqual([
      "modified",
      "added",
      "untracked",
    ]);
    expect(filterWorkspaceByKind(sample, "untracked")).toHaveLength(1);
    expect(filterEntriesByKind(sample, "all")).toHaveLength(3);
  });

  it("normalizes kind filter ids", () => {
    expect(normalizeChangesKindFilter("Modified")).toBe("modified");
    expect(normalizeChangesKindFilter("all")).toBe("all");
    expect(normalizeChangesKindFilter("nope")).toBe("all");
  });

  it("title keys are stable", () => {
    expect(workspaceGitUnavailableTitleKey("no_repo")).toBe(
      "changes.workspace.noRepo",
    );
    expect(workspaceGitUnavailableHintKey("load_error")).toBe(
      "changes.workspace.loadErrorHint",
    );
  });
});
