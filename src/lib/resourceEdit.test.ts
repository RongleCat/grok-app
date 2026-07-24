import { describe, expect, it } from "vitest";
import {
  defaultResourceEditMode,
  isFsWriteConflict,
  isResourceDraftDirty,
  isResourceTextEditable,
} from "./resourceEdit";

describe("isResourceTextEditable", () => {
  it("allows code/text/markdown with body", () => {
    expect(
      isResourceTextEditable({ kind: "code", text: "fn main() {}", truncated: false }),
    ).toBe(true);
    expect(
      isResourceTextEditable({ kind: "markdown", text: "# hi", truncated: false }),
    ).toBe(true);
  });

  it("rejects truncated or binary/media", () => {
    expect(
      isResourceTextEditable({ kind: "code", text: "x", truncated: true }),
    ).toBe(false);
    expect(
      isResourceTextEditable({ kind: "image", text: null, truncated: false }),
    ).toBe(false);
    expect(
      isResourceTextEditable({ kind: "binary", text: null, truncated: false }),
    ).toBe(false);
  });
});

describe("isResourceDraftDirty", () => {
  it("compares draft to baseline", () => {
    expect(isResourceDraftDirty(null, "a")).toBe(false);
    expect(isResourceDraftDirty("a", "a")).toBe(false);
    expect(isResourceDraftDirty("b", "a")).toBe(true);
  });
});

describe("isFsWriteConflict / defaultResourceEditMode", () => {
  it("detects conflict prefix", () => {
    expect(isFsWriteConflict("CONFLICT: file changed on disk")).toBe(true);
    expect(isFsWriteConflict("write temp: disk full")).toBe(false);
  });

  it("markdown starts in preview", () => {
    expect(defaultResourceEditMode("markdown")).toBe(false);
    expect(defaultResourceEditMode("code")).toBe(true);
  });
});
