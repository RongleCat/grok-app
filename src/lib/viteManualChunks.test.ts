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

  it("groups TipTap / ProseMirror, with React core in its own chunk", () => {
    expect(
      vendorManualChunk("/repo/node_modules/@tiptap/react/dist/index.js"),
    ).toBe("tiptap");
    expect(
      vendorManualChunk("/repo/node_modules/prosemirror-model/dist/index.js"),
    ).toBe("tiptap");
    expect(
      vendorManualChunk("/repo/node_modules/react-dom/index.js"),
    ).toBe("framework");
    expect(vendorManualChunk("/repo/node_modules/react/index.js")).toBe(
      "framework",
    );
    expect(
      vendorManualChunk("/repo/node_modules/react/jsx-runtime.js"),
    ).toBe("framework");
    expect(
      vendorManualChunk("D:\\repo\\node_modules\\react-dom\\client.js"),
    ).toBe("framework");
    expect(
      vendorManualChunk("/repo/node_modules/scheduler/index.js"),
    ).toBe("framework");
  });

  it("groups CodeMirror / lezer / style-mod together", () => {
    expect(
      vendorManualChunk("/repo/node_modules/@codemirror/view/dist/index.js"),
    ).toBe("codemirror");
    expect(
      vendorManualChunk(
        "D:\\repo\\node_modules\\@codemirror\\language\\dist\\index.js",
      ),
    ).toBe("codemirror");
    expect(
      vendorManualChunk("/repo/node_modules/@lezer/highlight/dist/index.js"),
    ).toBe("codemirror");
    expect(
      vendorManualChunk("/repo/node_modules/style-mod/src/style-mod.js"),
    ).toBe("codemirror");
    expect(
      vendorManualChunk("/repo/node_modules/crelt/index.js"),
    ).toBe("codemirror");
  });

  it("groups react-markdown and remark-gfm", () => {
    expect(
      vendorManualChunk("/repo/node_modules/react-markdown/index.js"),
    ).toBe("markdown");
    expect(
      vendorManualChunk("/repo/node_modules/remark-gfm/index.js"),
    ).toBe("markdown");
    expect(
      vendorManualChunk("/repo/node_modules/remark-math/index.js"),
    ).toBe("markdown");
    expect(
      vendorManualChunk("/repo/node_modules/rehype-katex/index.js"),
    ).toBe("markdown");
    expect(
      vendorManualChunk("/repo/node_modules/katex/dist/katex.min.js"),
    ).toBe("markdown");
    expect(
      vendorManualChunk("/repo/node_modules/micromark/index.js"),
    ).toBe("markdown");
    expect(
      vendorManualChunk("/repo/node_modules/katex/dist/katex.js"),
    ).toBe("markdown");
    expect(
      vendorManualChunk("/repo/node_modules/remark-math/index.js"),
    ).toBe("markdown");
    expect(
      vendorManualChunk("/repo/node_modules/rehype-katex/index.js"),
    ).toBe("markdown");
  });
});
