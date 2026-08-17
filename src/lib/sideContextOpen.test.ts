import { describe, expect, it } from "vitest";
import { emptySideWorkbenchState } from "./sideWorkbench";
import { applySideContextOpen } from "./sideContextOpen";

describe("applySideContextOpen", () => {
  it("opens file tab with path", () => {
    const r = applySideContextOpen(emptySideWorkbenchState(), {
      type: "file",
      path: "/a/b.ts",
      title: "b.ts",
    });
    expect(r.kind).toBe("file");
    expect(r.needAsideOpen).toBe(true);
    expect(r.state.tabs[0]?.kind).toBe("file");
    expect(r.state.tabs[0] && r.state.tabs[0].kind === "file" && r.state.tabs[0].path).toBe(
      "/a/b.ts",
    );
  });

  it("adopts a project-root directory chip when opening a file", () => {
    const withRoot = applySideContextOpen(
      emptySideWorkbenchState(),
      { type: "file", path: "/proj", title: "proj" },
    );
    const r = applySideContextOpen(
      withRoot.state,
      { type: "file", path: "/proj/src/a.ts", title: "a.ts" },
      { projectRoot: "/proj" },
    );
    expect(r.state.tabs.filter((t) => t.kind === "file")).toHaveLength(1);
    expect(r.state.tabs[0]).toMatchObject({
      kind: "file",
      path: "/proj/src/a.ts",
      name: "a.ts",
    });
  });

  it("forwards path:line focus onto the file tab", () => {
    const r = applySideContextOpen(emptySideWorkbenchState(), {
      type: "file",
      path: "/a/b.ts",
      title: "b.ts",
      line: 42,
      column: 3,
    });
    const tab = r.state.tabs[0];
    expect(tab?.kind).toBe("file");
    if (tab?.kind === "file") {
      expect(tab.line).toBe(42);
      expect(tab.column).toBe(3);
    }
  });

  it("opens browser tab for url", () => {
    const r = applySideContextOpen(emptySideWorkbenchState(), {
      type: "url",
      url: "https://example.com",
    });
    expect(r.kind).toBe("browser");
    expect(r.state.tabs[0]?.kind).toBe("browser");
  });

  it("opens review only when git", () => {
    const no = applySideContextOpen(
      emptySideWorkbenchState(),
      { type: "changes" },
      { isGitProject: false },
    );
    expect(no.state.tabs).toHaveLength(0);
    expect(no.needAsideOpen).toBe(false);
    expect(no.noticeKey).toBe("side.review.notGit");

    const yes = applySideContextOpen(
      emptySideWorkbenchState(),
      { type: "changes" },
      { isGitProject: true },
    );
    expect(yes.state.tabs[0]?.kind).toBe("review");
    expect(yes.needAsideOpen).toBe(true);
    // Default label is i18n key (not English "Review")
    expect(yes.state.tabs[0]?.name).toBe("side.tab.review");
  });
});
