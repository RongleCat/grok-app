import { describe, expect, it } from "vitest";
import {
  appendPluginDir,
  normalizePluginDirs,
  pluginDirSpawnArgs,
} from "./sessionPluginDirs";

describe("normalizePluginDirs", () => {
  it("returns empty for nullish / empty input", () => {
    expect(normalizePluginDirs(null)).toEqual([]);
    expect(normalizePluginDirs(undefined)).toEqual([]);
    expect(normalizePluginDirs([])).toEqual([]);
  });

  it("trims, drops empties, and dedupes first-wins", () => {
    expect(
      normalizePluginDirs([
        "  /a/plugins  ",
        "",
        "/b",
        "/a/plugins",
        "   ",
        "/b",
      ]),
    ).toEqual(["/a/plugins", "/b"]);
  });
});

describe("pluginDirSpawnArgs", () => {
  it("builds repeatable --plugin-dir pairs", () => {
    expect(pluginDirSpawnArgs(["/p1", "/p2"])).toEqual([
      "--plugin-dir",
      "/p1",
      "--plugin-dir",
      "/p2",
    ]);
  });

  it("omits the flag when there are no dirs", () => {
    expect(pluginDirSpawnArgs([])).toEqual([]);
    expect(pluginDirSpawnArgs(null)).toEqual([]);
    expect(pluginDirSpawnArgs(["  ", ""])).toEqual([]);
  });

  it("does not invent global extension flags", () => {
    const args = pluginDirSpawnArgs(["/local-plugin"]);
    expect(args).not.toContain("plugin");
    expect(args[0]).toBe("--plugin-dir");
    expect(args.join(" ")).not.toMatch(/install|enable|marketplace/);
  });
});

describe("appendPluginDir", () => {
  it("appends a new path", () => {
    expect(appendPluginDir(["/a"], "/b")).toEqual(["/a", "/b"]);
  });

  it("ignores empty and duplicate paths", () => {
    expect(appendPluginDir(["/a"], "  ")).toEqual(["/a"]);
    expect(appendPluginDir(["/a"], "/a")).toEqual(["/a"]);
    expect(appendPluginDir(null, "/x")).toEqual(["/x"]);
  });
});
