import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);

function autolinkEntry(): string {
  const fromGfm = createRequire(require.resolve("remark-gfm"));
  const fromUtil = createRequire(fromGfm.resolve("mdast-util-gfm"));
  return fromUtil.resolve("mdast-util-gfm-autolink-literal");
}

type MdNode = {
  type: string;
  url?: string;
  value?: string;
  children?: MdNode[];
};

function transform(value: string): MdNode {
  return {
    type: "root",
    children: [
      { type: "paragraph", children: [{ type: "text", value }] },
    ],
  };
}

function urls(node: MdNode): string[] {
  const out: string[] = [];
  if (node.type === "link" && node.url) out.push(node.url);
  for (const child of node.children ?? []) out.push(...urls(child));
  return out;
}

describe("GFM autolink literals on macOS 12 WebKit", () => {
  it("does not compile a lookbehind", () => {
    const src = readFileSync(
      join(dirname(autolinkEntry()), "lib/index.js"),
      "utf8",
    );
    expect(src).not.toMatch(/\(\?<[=!]/);
  });

  it("still links a bare email and skips one after a slash", async () => {
    const mod = (await import(pathToFileURL(autolinkEntry()).href)) as {
      gfmAutolinkLiteralFromMarkdown: () => {
        transforms: Array<(tree: MdNode) => void>;
      };
    };
    const run = (value: string) => {
      const tree = transform(value);
      mod.gfmAutolinkLiteralFromMarkdown().transforms[0](tree);
      return urls(tree);
    };
    expect(run("Mail ada@example.com today.")).toEqual([
      "mailto:ada@example.com",
    ]);
    expect(run("See file/ada@example.com today.")).toEqual([]);
  });
});
