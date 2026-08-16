import { describe, expect, it } from "vitest";
import {
  appendAttachmentRefsToContent,
  applyResolvedSessionMedia,
  buildAgentPrompt,
  buildInlineMediaPathMap,
  extractMediaPathsFromContent,
  extractSessionRelativeMediaRefs,
  filterAttachmentsNotInlined,
  mediaTailFromPath,
  isDisplayableAttachmentPath,
  isImagePath,
  isMediaPath,
  isPlausibleLocalMediaAbs,
  isVideoPath,
  joinSessionMediaPath,
  mergeAttachments,
  mergeMessageAttachments,
  parseAttachmentsFromContent,
  pathBasename,
  resolveInlineMediaToken,
  resolveMediaHref,
  type Attachment,
} from "./attachments";

const file: Attachment = {
  path: "/tmp/a.txt",
  name: "a.txt",
  isDir: false,
};
const dir: Attachment = {
  path: "/tmp/proj",
  name: "proj",
  isDir: true,
};

describe("attachments", () => {
  it("dedupes by path", () => {
    const out = mergeAttachments([file], [{ ...file, name: "renamed" }, dir]);
    expect(out).toHaveLength(2);
    expect(out.find((a) => a.path === file.path)?.name).toBe("renamed");
  });

  it("builds agent prompt with @paths", () => {
    expect(buildAgentPrompt("hi", [file, dir])).toBe(
      "hi\n\n@/tmp/a.txt\n@/tmp/proj",
    );
    expect(buildAgentPrompt("", [file])).toBe("@/tmp/a.txt");
  });

  it("parses @paths back out of content", () => {
    const raw = "hello\n\n@/Users/me/pic.png\n@/Users/me/docs";
    const { text, attachments } = parseAttachmentsFromContent(raw);
    expect(text).toBe("hello");
    expect(attachments).toHaveLength(2);
    expect(attachments[0]!.path).toBe("/Users/me/pic.png");
    expect(attachments[0]!.name).toBe("pic.png");
  });

  it("append+parse keeps internal blank lines in body", () => {
    const body = "a\n\nb\n\nc";
    const withRefs = appendAttachmentRefsToContent(body, [
      { path: "/tmp/shot.png", name: "shot.png", isDir: false },
    ]);
    expect(withRefs).toBe("a\n\nb\n\nc\n\n@/tmp/shot.png");
    const { text, attachments } = parseAttachmentsFromContent(withRefs);
    expect(text).toBe("a\n\nb\n\nc");
    expect(text.includes("\n\n")).toBe(true);
    expect(attachments.map((a) => a.path)).toEqual(["/tmp/shot.png"]);
  });

  it("append is idempotent for existing @path lines", () => {
    const once = appendAttachmentRefsToContent("hello\n\nworld", [file]);
    const twice = appendAttachmentRefsToContent(once, [file]);
    expect(twice).toBe(once);
  });

  it("detects image and video extensions", () => {
    expect(isImagePath("/a/b.PNG")).toBe(true);
    expect(isImagePath("/a/b.docx")).toBe(false);
    expect(isVideoPath("/a/b.mp4")).toBe(true);
    expect(isVideoPath("/a/b.mov")).toBe(true);
    expect(isMediaPath("/a/b.webm")).toBe(true);
    expect(isMediaPath("/a/b.txt")).toBe(false);
  });

  it("basename works", () => {
    expect(pathBasename("/foo/bar/baz.txt")).toBe("baz.txt");
  });

  it("extracts absolute media paths from assistant prose", () => {
    const content = `完整路径：

\`/Users/me/Library/Application Support/com.grokapp.grok-app/agent-home/sessions/abc/images/1.jpg\`

also /tmp/other.png and /tmp/clip.mp4 and not a file.`;
    const atts = extractMediaPathsFromContent(content);
    expect(atts.map((a) => a.path)).toEqual([
      "/Users/me/Library/Application Support/com.grokapp.grok-app/agent-home/sessions/abc/images/1.jpg",
      "/tmp/other.png",
      "/tmp/clip.mp4",
    ]);
    expect(atts[0]!.name).toBe("1.jpg");
  });

  it("extracts absolute video after CJK colon (history prose)", () => {
    const atts = extractMediaPathsFromContent(
      "成片位置：/Users/me/proj/out/moon-taste-story.mp4\n时长约 3 分钟",
    );
    expect(atts.map((a) => a.path)).toEqual([
      "/Users/me/proj/out/moon-taste-story.mp4",
    ]);
  });

  it("extracts shell-escaped absolute images from user prose", () => {
    const atts = extractMediaPathsFromContent(
      "logo换成/Users/me/Downloads/6A5ED46119BDACC7C24DC3B6FF3CF051\\ \\(1\\).png",
    );
    expect(atts.map((a) => a.path)).toEqual([
      "/Users/me/Downloads/6A5ED46119BDACC7C24DC3B6FF3CF051 (1).png",
    ]);
  });

  it("ignores CMS site-root media paths", () => {
    expect(
      extractMediaPathsFromContent(
        "logo：`/images/partner-brands/manycore-20260730.png`",
      ),
    ).toEqual([]);
    expect(
      resolveInlineMediaToken("/images/partner-brands/x.png", null),
    ).toBeNull();
  });

  it("does not re-match mid-path media segments inside a longer absolute", () => {
    // Without a non-path boundary, bareSimple could also hit
    // `/com.grokapp/.../images/1.jpg` mid-string (WebKit lookbehind rewrite).
    const atts = extractMediaPathsFromContent(
      "path /data/workspace/Support/com.grokapp/agent-home/images/1.jpg end",
    );
    expect(atts.map((a) => a.path)).toEqual([
      "/data/workspace/Support/com.grokapp/agent-home/images/1.jpg",
    ]);
  });

  it("extracts bare absolute media after CJK glue without lookbehind", () => {
    const atts = extractMediaPathsFromContent(
      "路径：/workspace/out/card.png 和 ~/shots/v1.mp4",
    );
    expect(atts.map((a) => a.path).sort()).toEqual([
      "/workspace/out/card.png",
      "~/shots/v1.mp4",
    ].sort());
  });

  it("does not extract mid-path /basename after space + CJK folder (session bug)", () => {
    // Live failure: media server got path=/replica_v2.mp4 from
    // `…/grok 美女视频/replica_v2.mp4` (prev char 频 not in [A-Za-z0-9_./-]).
    const content = [
      "| 成片 | `/Users/ronglecat/Downloads/grok 美女视频/replica_v2.mp4` |",
      "",
      "可直接打开 `replica_v2.mp4` 看全片。",
      "bare /Users/ronglecat/Downloads/grok 美女视频/replica_black_outfit.mp4 end",
    ].join("\n");
    const atts = extractMediaPathsFromContent(content);
    const paths = atts.map((a) => a.path);
    expect(paths).toContain(
      "/Users/ronglecat/Downloads/grok 美女视频/replica_v2.mp4",
    );
    expect(paths).toContain(
      "/Users/ronglecat/Downloads/grok 美女视频/replica_black_outfit.mp4",
    );
    expect(paths.some((p) => p === "/replica_v2.mp4")).toBe(false);
    expect(paths.some((p) => p === "/replica_black_outfit.mp4")).toBe(false);
    expect(paths.every((p) => isPlausibleLocalMediaAbs(p))).toBe(true);
  });

  it("extracts Application Support paths with unescaped spaces (bare + ticks)", () => {
    const abs =
      "/Users/me/Library/Application Support/com.grokapp.grok-app/agent-home/sessions/abc/videos/1.mp4";
    const atts = extractMediaPathsFromContent(
      `成片：\`${abs}\`\nalso bare ${abs} done`,
    );
    expect(atts.map((a) => a.path)).toEqual([abs]);
  });

  it("still allows CJK glue before known roots", () => {
    const atts = extractMediaPathsFromContent(
      "logo换成/Users/me/Downloads/shot.png 完成",
    );
    expect(atts.map((a) => a.path)).toEqual([
      "/Users/me/Downloads/shot.png",
    ]);
  });

  it("isPlausibleLocalMediaAbs rejects single-segment false extracts", () => {
    expect(isPlausibleLocalMediaAbs("/replica_v2.mp4")).toBe(false);
    expect(isPlausibleLocalMediaAbs("/img_001.png")).toBe(false);
    expect(isPlausibleLocalMediaAbs("/tmp/clip.mp4")).toBe(true);
    expect(isPlausibleLocalMediaAbs("~/shots/v1.mp4")).toBe(true);
    expect(isPlausibleLocalMediaAbs("C:/Users/me/a.mp4")).toBe(true);
    expect(isPlausibleLocalMediaAbs("C:\\Users\\me\\a.mp4")).toBe(true);
    expect(isDisplayableAttachmentPath("/replica_v2.mp4")).toBe(false);
    expect(resolveInlineMediaToken("/replica_v2.mp4", null)).toBeNull();
  });

  it("drops fused media query keys from displayable attachments", () => {
    expect(isDisplayableAttachmentPath("t:/Users/me/pic.png")).toBe(false);
    expect(isDisplayableAttachmentPath("p:/Users/me/a.jpg")).toBe(false);
    expect(isDisplayableAttachmentPath("C:/Users/me/pic.png")).toBe(true);
  });

  it("mergeMessageAttachments combines stored + text paths", () => {
    const out = mergeMessageAttachments(
      [{ path: "/tmp/a.png", name: "a.png", isDir: false }],
      "see `/tmp/b.jpg`",
    );
    expect(out).toHaveLength(2);
    expect(out?.map((a) => a.path).sort()).toEqual(["/tmp/a.png", "/tmp/b.jpg"]);
  });

  it("mergeMessageAttachments ignores single-segment abs media in text", () => {
    const out = mergeMessageAttachments(
      [{ path: "/tmp/a.png", name: "a.png", isDir: false }],
      "broken tail `/replica_v2.mp4` and bare /file.mp4",
    );
    expect(out?.map((a) => a.path)).toEqual(["/tmp/a.png"]);
  });

  it("extracts Grok short session-relative media refs", () => {
    const content = `图片已生成：

**\`images/1.jpg\`**

画面是一只小猫`;
    expect(extractSessionRelativeMediaRefs(content)).toEqual(["images/1.jpg"]);
    expect(extractSessionRelativeMediaRefs("also images/2.png ok")).toEqual([
      "images/2.png",
    ]);
    expect(extractSessionRelativeMediaRefs("/abs/images/1.jpg")).toEqual([]);
    // Markdown link form
    expect(
      extractSessionRelativeMediaRefs(
        "已生成：\n\n**[images/1.jpg](images/1.jpg)**\n",
      ),
    ).toEqual(["images/1.jpg"]);
    // Video short paths
    expect(
      extractSessionRelativeMediaRefs(
        "视频：\n\n**[videos/1.mp4](videos/1.mp4)**\n",
      ),
    ).toEqual(["videos/1.mp4"]);
    expect(extractSessionRelativeMediaRefs("`videos/2.webm`")).toEqual([
      "videos/2.webm",
    ]);
    // Skill output under project cwd (xhx-media-gen etc.)
    expect(
      extractSessionRelativeMediaRefs(
        "**本地文件：**\n`outputs/xhx-media-gen/kitten-drinking-water-cartoon-grotesque.png`\n",
      ),
    ).toEqual([
      "outputs/xhx-media-gen/kitten-drinking-water-cartoon-grotesque.png",
    ]);
    // Bare basenames in ticks (workspace copies) — needed after session reload
    expect(
      extractSessionRelativeMediaRefs(
        "1. 数据准确版\n`shenzhen-weather-card.png`\n2. 插画\n`images/1.jpg`（副本：`shenzhen-weather-anime.jpg`）\n",
      ),
    ).toEqual([
      "images/1.jpg",
      "shenzhen-weather-card.png",
      "shenzhen-weather-anime.jpg",
    ]);
    // Bare prose without ticks must not match (false positives)
    expect(
      extractSessionRelativeMediaRefs("see logo.png in the folder"),
    ).toEqual([]);
    // Markdown link bare basename
    expect(
      extractSessionRelativeMediaRefs("[card](weather-card.png)"),
    ).toEqual(["weather-card.png"]);
  });

  it("resolveMediaHref maps link href to absolute via path map", () => {
    const map = {
      "images/1.jpg": "/sess/images/1.jpg",
      "videos/1.mp4": "/sess/videos/1.mp4",
    };
    expect(resolveMediaHref("images/1.jpg", "images/1.jpg", map)).toBe(
      "/sess/images/1.jpg",
    );
    expect(resolveMediaHref("videos/1.mp4", "clip", map)).toBe(
      "/sess/videos/1.mp4",
    );
    expect(resolveMediaHref("https://example.com", "x", map)).toBeNull();
  });

  it("joins session media root with relative path", () => {
    expect(
      joinSessionMediaPath(
        "/Users/me/agent-home/sessions/abc/019f",
        "images/1.jpg",
      ),
    ).toBe("/Users/me/agent-home/sessions/abc/019f/images/1.jpg");
    expect(
      joinSessionMediaPath(
        "/Users/me/agent-home/sessions/abc/019f",
        "videos/1.mp4",
      ),
    ).toBe("/Users/me/agent-home/sessions/abc/019f/videos/1.mp4");
  });

  it("applyResolvedSessionMedia attaches cards for short paths", () => {
    const msgs = [
      {
        role: "assistant" as const,
        content: "已生成\n\n**`images/1.jpg`**\n\nand `videos/1.mp4`",
        attachments: undefined as Attachment[] | undefined,
      },
    ];
    const resolved: Attachment[] = [
      { path: "/sess/images/1.jpg", name: "1.jpg", isDir: false },
      { path: "/sess/videos/1.mp4", name: "1.mp4", isDir: false },
    ];
    const out = applyResolvedSessionMedia(msgs, resolved);
    expect(out[0]!.attachments).toHaveLength(2);
    expect(out[0]!.attachments!.map((a) => a.path).sort()).toEqual([
      "/sess/images/1.jpg",
      "/sess/videos/1.mp4",
    ]);
  });

  it("mediaTailFromPath keeps design-demo / shots tails", () => {
    expect(
      mediaTailFromPath(
        "/Users/sunny/GROK/VIKO/design-demos/shots/preview-v3-03-editorial.png",
      ),
    ).toBe("design-demos/shots/preview-v3-03-editorial.png");
    expect(mediaTailFromPath("/sess/images/1.jpg")).toBe("images/1.jpg");
  });

  it("resolveInlineMediaToken maps project-relative markdown href via basename", () => {
    const map = buildInlineMediaPathMap([
      {
        path: "/Users/me/proj/design-demos/shots/preview-v3-03-editorial.png",
        name: "preview-v3-03-editorial.png",
        isDir: false,
      },
    ]);
    expect(
      resolveInlineMediaToken(
        "design-demos/shots/preview-v3-03-editorial.png",
        map,
      ),
    ).toBe("/Users/me/proj/design-demos/shots/preview-v3-03-editorial.png");
    expect(map["design-demos/shots/preview-v3-03-editorial.png"]).toBe(
      "/Users/me/proj/design-demos/shots/preview-v3-03-editorial.png",
    );
  });

  it("filterAttachmentsNotInlined drops project-relative markdown images", () => {
    const atts: Attachment[] = [
      {
        path: "/Users/me/proj/design-demos/shots/preview-v3-03-editorial.png",
        name: "preview-v3-03-editorial.png",
        isDir: false,
      },
    ];
    const out = filterAttachmentsNotInlined(
      "![03 巨字](design-demos/shots/preview-v3-03-editorial.png)",
      atts,
    );
    expect(out).toBeUndefined();
  });

  it("buildInlineMediaPathMap maps short tokens to absolute", () => {
    const map = buildInlineMediaPathMap([
      { path: "/sess/images/1.jpg", name: "1.jpg", isDir: false },
      { path: "/sess/videos/1.mp4", name: "1.mp4", isDir: false },
    ]);
    expect(map["images/1.jpg"]).toBe("/sess/images/1.jpg");
    expect(map["videos/1.mp4"]).toBe("/sess/videos/1.mp4");
    expect(resolveInlineMediaToken("videos/1.mp4", map)).toBe(
      "/sess/videos/1.mp4",
    );
  });

  it("filterAttachmentsNotInlined drops media already in body text", () => {
    const atts: Attachment[] = [
      { path: "/sess/images/1.jpg", name: "1.jpg", isDir: false },
      { path: "/sess/videos/1.mp4", name: "1.mp4", isDir: false },
      { path: "/sess/notes.txt", name: "notes.txt", isDir: false },
    ];
    const out = filterAttachmentsNotInlined(
      "图片：\n\n**`images/1.jpg`**\n视频：\n**[videos/1.mp4](videos/1.mp4)**\n",
      atts,
    );
    expect(out).toHaveLength(1);
    expect(out![0]!.name).toBe("notes.txt");
  });

  it("filterAttachmentsNotInlined drops false-extract single-segment abs media", () => {
    const atts: Attachment[] = [
      { path: "/img_001.png", name: "img_001.png", isDir: false },
      {
        path: "/Users/me/chat/media/img_001.png",
        name: "img_001.png",
        isDir: false,
      },
    ];
    const out = filterAttachmentsNotInlined("done", atts);
    expect(out).toHaveLength(1);
    expect(out![0]!.path).toBe("/Users/me/chat/media/img_001.png");
  });
});
