import { describe, expect, it } from "vitest";
import { vendorManualChunk } from "./viteManualChunks";

describe("vendorManualChunk", () => {
  it("ignores app source", () => {
    expect(vendorManualChunk("/repo/src/components/MarkdownChat.tsx")).toBeUndefined();
  });

  it("groups xterm including Windows paths", () => {
    expect(
      vendorManualChunk("D:\\repo\\node_modules\\@xterm\\xterm\\lib\\xterm.js"),
    ).toBe("xterm");
    expect(
      vendorManualChunk("/repo/node_modules/@xterm/addon-webgl/lib/addon.js"),
    ).toBe("xterm");
  });

  it("groups TipTap / ProseMirror, not React", () => {
    expect(
      vendorManualChunk("/repo/node_modules/@tiptap/react/dist/index.js"),
    ).toBe("tiptap");
    expect(
      vendorManualChunk("/repo/node_modules/prosemirror-model/dist/index.js"),
    ).toBe("tiptap");
    expect(
      vendorManualChunk("/repo/node_modules/react-dom/index.js"),
    ).toBeUndefined();
  });

  it("groups react-markdown and remark-gfm", () => {
    expect(
      vendorManualChunk("/repo/node_modules/react-markdown/index.js"),
    ).toBe("markdown");
    expect(
      vendorManualChunk("/repo/node_modules/remark-gfm/index.js"),
    ).toBe("markdown");
    expect(
      vendorManualChunk("/repo/node_modules/micromark/index.js"),
    ).toBe("markdown");
  });
});
