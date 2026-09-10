import { describe, expect, it } from "vitest";
import {
  appDisplayVersion,
  resolveAppDisplayVersion,
} from "./appDisplayVersion";

describe("resolveAppDisplayVersion", () => {
  it("shows the exact release tag when HEAD is that tag", () => {
    expect(
      resolveAppDisplayVersion({
        tagsAtHead: ["v0.2.33"],
        shortSha: "abc1234",
        packageVersion: "0.2.33",
      }),
    ).toBe("v0.2.33");
  });

  it("prefers the tag that matches package.json when several vX.Y.Z tags point at HEAD", () => {
    expect(
      resolveAppDisplayVersion({
        tagsAtHead: ["v0.2.32", "v0.2.33"],
        shortSha: "abc1234",
        packageVersion: "0.2.33",
      }),
    ).toBe("v0.2.33");
  });

  it("still shows a release tag when package.json has already moved on", () => {
    expect(
      resolveAppDisplayVersion({
        tagsAtHead: ["v0.2.33"],
        shortSha: "abc1234",
        packageVersion: "0.2.34",
      }),
    ).toBe("v0.2.33");
  });

  it("ignores non-release tags (rc, extra suffix) and falls through to the hash", () => {
    expect(
      resolveAppDisplayVersion({
        tagsAtHead: ["v0.2.33-rc.1", "nightly", "v0.2.33.1"],
        shortSha: "deadbee",
        packageVersion: "0.2.33",
      }),
    ).toBe("deadbee");
  });

  it("shows the short commit hash when HEAD is not an exact release tag", () => {
    expect(
      resolveAppDisplayVersion({
        tagsAtHead: [],
        shortSha: "c0ffee1",
        packageVersion: "0.2.33",
      }),
    ).toBe("c0ffee1");
  });

  it("accepts 7–40 hex chars from git rev-parse --short / full SHA", () => {
    expect(
      resolveAppDisplayVersion({
        shortSha: "abcd12345678",
        packageVersion: "0.2.33",
      }),
    ).toBe("abcd12345678");
    expect(
      resolveAppDisplayVersion({
        shortSha: "a".repeat(40),
        packageVersion: "0.2.33",
      }),
    ).toBe("a".repeat(40));
  });

  it("uses GITHUB_REF when CI checks out a tag without local tags", () => {
    expect(
      resolveAppDisplayVersion({
        tagsAtHead: [],
        shortSha: "abc1234",
        packageVersion: "0.2.33",
        githubRef: "refs/tags/v0.2.33",
      }),
    ).toBe("v0.2.33");
  });

  it("uses GITHUB_REF_NAME when GITHUB_REF_TYPE is tag", () => {
    expect(
      resolveAppDisplayVersion({
        tagsAtHead: [],
        shortSha: "abc1234",
        packageVersion: "0.2.33",
        githubRefType: "tag",
        githubRefName: "v0.2.33",
      }),
    ).toBe("v0.2.33");
  });

  it("does not treat a branch name as a release tag", () => {
    expect(
      resolveAppDisplayVersion({
        tagsAtHead: [],
        shortSha: "abc1234",
        packageVersion: "0.2.33",
        githubRef: "refs/heads/main",
        githubRefType: "branch",
        githubRefName: "main",
      }),
    ).toBe("abc1234");
  });

  it("lets an explicit override win", () => {
    expect(
      resolveAppDisplayVersion({
        displayOverride: "  mine  ",
        tagsAtHead: ["v0.2.33"],
        shortSha: "abc1234",
        packageVersion: "0.2.33",
        githubRef: "refs/tags/v0.2.33",
      }),
    ).toBe("mine");
  });

  it("falls back to v + package.json when git identity is missing", () => {
    expect(
      resolveAppDisplayVersion({ packageVersion: "0.2.33" }),
    ).toBe("v0.2.33");
    expect(
      resolveAppDisplayVersion({ packageVersion: "v0.2.33" }),
    ).toBe("v0.2.33");
    expect(resolveAppDisplayVersion({ shortSha: "not-a-sha" })).toBe("");
    expect(resolveAppDisplayVersion({})).toBe("");
  });

  it("bakes a tag or short hash through Vite define", () => {
    expect(appDisplayVersion()).toMatch(/^(v\d+\.\d+\.\d+|[0-9a-f]{7,40})$/i);
  });
});
