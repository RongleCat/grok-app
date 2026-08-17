import { describe, expect, it } from "vitest";
import {
  disambiguateFileTabLabels,
  fileTabBasename,
} from "./fileTabChipLabel";

describe("fileTabBasename", () => {
  it("prefers the last path segment", () => {
    expect(fileTabBasename("/a/b/采购退货单流程.js", "other.js")).toBe(
      "采购退货单流程.js",
    );
    expect(fileTabBasename("src\\lib\\utils.ts")).toBe("utils.ts");
  });

  it("falls back to name, then file", () => {
    expect(fileTabBasename(undefined, "README.md")).toBe("README.md");
    expect(fileTabBasename("   ", "  ")).toBe("file");
  });
});

describe("disambiguateFileTabLabels", () => {
  it("keeps the basename when names are unique", () => {
    const labels = disambiguateFileTabLabels([
      { id: "a", path: "/proj/src/app.ts" },
      { id: "b", path: "/proj/src/main.ts" },
    ]);
    expect(labels.get("a")).toBe("app.ts");
    expect(labels.get("b")).toBe("main.ts");
  });

  it("adds the shortest parent when two files share a name", () => {
    const labels = disambiguateFileTabLabels([
      { id: "a", path: "/proj/src/utils.ts" },
      { id: "b", path: "/proj/lib/utils.ts" },
    ]);
    expect(labels.get("a")).toBe("src/utils.ts");
    expect(labels.get("b")).toBe("lib/utils.ts");
  });

  it("walks further when the parent folder also collides", () => {
    const labels = disambiguateFileTabLabels([
      { id: "a", path: "/proj/pkg/src/index.ts" },
      { id: "b", path: "/proj/app/src/index.ts" },
    ]);
    expect(labels.get("a")).toBe("pkg/src/index.ts");
    expect(labels.get("b")).toBe("app/src/index.ts");
  });

  it("normalizes Windows separators", () => {
    const labels = disambiguateFileTabLabels([
      { id: "a", path: "C:\\proj\\src\\utils.ts" },
      { id: "b", path: "C:\\proj\\lib\\utils.ts" },
    ]);
    expect(labels.get("a")).toBe("src/utils.ts");
    expect(labels.get("b")).toBe("lib/utils.ts");
  });

  it("uses the localized name when a tab has no path", () => {
    const labels = disambiguateFileTabLabels([
      { id: "empty", name: "文件" },
      { id: "real", path: "/a/b.ts", name: "b.ts" },
    ]);
    expect(labels.get("empty")).toBe("文件");
    expect(labels.get("real")).toBe("b.ts");
  });
});
