import { describe, expect, it } from "vitest";
import {
  isPathUnderProject,
  joinProjectRoot,
  normalizeSidePath,
  resolveSidePathDeepLink,
  toProjectRelative,
} from "./sidePathDeepLink";

describe("normalizeSidePath", () => {
  it("trims, unescapes shell spaces, collapses trailing slash", () => {
    expect(normalizeSidePath("  /a/b/c/  ")).toBe("/a/b/c");
    expect(normalizeSidePath("file\\ name.ts")).toBe("file name.ts");
  });

  it("normalizes Windows separators to /", () => {
    expect(normalizeSidePath("C:\\proj\\src\\a.ts")).toBe("C:/proj/src/a.ts");
  });
});

describe("joinProjectRoot / under-project", () => {
  it("joins posix project + relative", () => {
    expect(joinProjectRoot("/Users/me/proj", "src/a.ts")).toBe(
      "/Users/me/proj/src/a.ts",
    );
  });

  it("joins Windows-style project root", () => {
    expect(joinProjectRoot("C:\\proj", "src\\a.ts")).toBe("C:\\proj\\src\\a.ts");
  });

  it("detects under-project and relative form", () => {
    expect(isPathUnderProject("/p", "/p/src/a.ts")).toBe(true);
    expect(isPathUnderProject("/p", "/p")).toBe(true);
    expect(isPathUnderProject("/p", "/other/a.ts")).toBe(false);
    expect(toProjectRelative("/p", "/p/src/a.ts")).toBe("src/a.ts");
    expect(toProjectRelative("/p", "/p")).toBe("");
    expect(toProjectRelative("/p", "/x")).toBeNull();
  });

  it("does not treat sibling prefix as under root", () => {
    expect(isPathUnderProject("/proj", "/proj-extra/a.ts")).toBe(false);
  });
});

describe("resolveSidePathDeepLink", () => {
  const root = "/Users/me/proj";

  it("opens absolute path under trusted project", () => {
    const r = resolveSidePathDeepLink({
      path: "/Users/me/proj/src/App.tsx",
      title: "App.tsx",
      projectPath: root,
      projectTrusted: true,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.path).toBe("/Users/me/proj/src/App.tsx");
    expect(r.relativePath).toBe("src/App.tsx");
    expect(r.title).toBe("App.tsx");
  });

  it("joins relative path under project", () => {
    const r = resolveSidePathDeepLink({
      path: "docs/README.md",
      projectPath: root,
      projectTrusted: true,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.path).toBe("/Users/me/proj/docs/README.md");
    expect(r.relativePath).toBe("docs/README.md");
  });

  it("soft-fails with no project + reveal when abs known", () => {
    const r = resolveSidePathDeepLink({
      path: "/tmp/x.ts",
      projectPath: null,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("no_project");
    expect(r.messageKey).toBe("resources.sideOpen.noProject");
    expect(r.shouldReveal).toBe(true);
    expect(r.revealPath).toBe("/tmp/x.ts");
  });

  it("soft-fails untrusted without auto-reveal", () => {
    const r = resolveSidePathDeepLink({
      path: "/Users/me/proj/a.ts",
      projectPath: root,
      projectTrusted: false,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("untrusted");
    expect(r.messageKey).toBe("resources.sideOpen.untrusted");
    expect(r.shouldReveal).toBe(false);
  });

  it("soft-fails outside project with reveal fallback", () => {
    const r = resolveSidePathDeepLink({
      path: "/etc/hosts",
      projectPath: root,
      projectTrusted: true,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("outside_project");
    expect(r.messageKey).toBe("resources.sideOpen.outsideProject");
    expect(r.shouldReveal).toBe(true);
    expect(r.revealPath).toBe("/etc/hosts");
  });

  it("soft-fails missing", () => {
    const r = resolveSidePathDeepLink({
      path: "/Users/me/proj/gone.ts",
      projectPath: root,
      projectTrusted: true,
      missing: true,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("missing");
    expect(r.messageKey).toBe("resources.openErr.notFound");
    expect(r.shouldReveal).toBe(false);
  });

  it("rejects empty and http urls", () => {
    expect(resolveSidePathDeepLink({ path: "  " }).ok).toBe(false);
    const u = resolveSidePathDeepLink({
      path: "https://example.com",
      projectPath: root,
      projectTrusted: true,
    });
    expect(u.ok).toBe(false);
    if (!u.ok) expect(u.reason).toBe("url");
  });

  it("allows when trusted is undefined (only false blocks)", () => {
    const r = resolveSidePathDeepLink({
      path: "a.ts",
      projectPath: root,
    });
    expect(r.ok).toBe(true);
  });
});
