import { describe, expect, it } from "vitest";
import {
  sshListDirIsQuietFailure,
  sshListDirShouldSetPaneError,
} from "./sshListDirHonesty";

describe("sshListDirShouldSetPaneError", () => {
  it("does not banner a successful list", () => {
    expect(
      sshListDirShouldSetPaneError({
        relative: "",
        result: { ok: true },
      }),
    ).toBe(false);
  });

  it("does not banner listing a file (path-chip ancestors)", () => {
    expect(
      sshListDirIsQuietFailure({ ok: false, errorCode: "not_a_dir" }),
    ).toBe(true);
    expect(
      sshListDirShouldSetPaneError({
        relative: ".cursor/skills",
        result: { ok: false, errorCode: "not_a_dir" },
      }),
    ).toBe(false);
    expect(
      sshListDirShouldSetPaneError({
        relative: "",
        result: { ok: false, errorCode: "not_a_dir" },
      }),
    ).toBe(false);
  });

  it("does not banner nested parse/SSH failures over a loaded file", () => {
    expect(
      sshListDirShouldSetPaneError({
        relative: ".cursor/skills/debuzz/scripts",
        result: { ok: false, errorCode: "parse", error: "remote ls failed" },
      }),
    ).toBe(false);
  });

  it("banners a real root listing failure", () => {
    expect(
      sshListDirShouldSetPaneError({
        relative: "",
        result: { ok: false, errorCode: "auth", error: "Permission denied" },
      }),
    ).toBe(true);
    expect(
      sshListDirShouldSetPaneError({
        relative: "",
        result: { ok: false, errorCode: "parse", error: "remote ls failed" },
      }),
    ).toBe(true);
  });
});
