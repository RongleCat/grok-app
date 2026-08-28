import { describe, expect, it } from "vitest";
import {
  resolveSshChatPath,
  sshChatAbsCandidate,
  sshChatRelative,
  sshRemoteDirToList,
} from "./sshChatPath";

const ROOT = "/inspire/hdd/project/pengqlu";

describe("sshChatAbsCandidate", () => {
  it("joins relative tokens under the remote cwd", () => {
    expect(sshChatAbsCandidate(ROOT, "anjin")).toBe(`${ROOT}/anjin`);
    expect(sshChatAbsCandidate(ROOT, "docs/a.md")).toBe(`${ROOT}/docs/a.md`);
  });

  it("keeps abs paths under the project and rejects siblings", () => {
    expect(sshChatAbsCandidate(ROOT, `${ROOT}/anjin`)).toBe(`${ROOT}/anjin`);
    expect(sshChatAbsCandidate(ROOT, "/tmp/x")).toBeNull();
  });
});

describe("resolveSshChatPath", () => {
  it("treats a successful list as a directory", async () => {
    const hit = await resolveSshChatPath("hpc", ROOT, "anjin", async () => ({
      ok: true,
      entries: [{ name: "x", isDir: false }],
    }));
    expect(hit).toEqual({
      abs: `${ROOT}/anjin`,
      relative: "anjin",
      isDir: true,
    });
  });

  it("falls back to parent listing for files", async () => {
    const hit = await resolveSshChatPath(
      "hpc",
      ROOT,
      "README.md",
      async (_alias, path) => {
        if (path === `${ROOT}/README.md`) return { ok: false, entries: [] };
        return {
          ok: true,
          entries: [
            { name: "README.md", isDir: false },
            { name: "anjin", isDir: true },
          ],
        };
      },
    );
    expect(hit).toEqual({
      abs: `${ROOT}/README.md`,
      relative: "README.md",
      isDir: false,
    });
    expect(sshChatRelative(ROOT, `${ROOT}/README.md`)).toBe("README.md");
  });

  it("does not treat an unrelated abs path as a project-relative", () => {
    expect(sshChatRelative(ROOT, "/tmp/x")).toBe("");
  });
});

describe("sshRemoteDirToList", () => {
  it("joins relative dirs and keeps abs dirs under the project", () => {
    expect(sshRemoteDirToList(ROOT, "")).toBe(ROOT);
    expect(sshRemoteDirToList(ROOT, "src")).toBe(`${ROOT}/src`);
    expect(sshRemoteDirToList(ROOT, `${ROOT}/src`)).toBe(`${ROOT}/src`);
    expect(sshRemoteDirToList(ROOT, "/tmp")).toBeNull();
    expect(sshRemoteDirToList(ROOT, "../etc")).toBeNull();
  });
});
