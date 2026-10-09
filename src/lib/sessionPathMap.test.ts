import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@/lib/session";
import { resolveFileToken } from "./pathRefs";
import {
  buildSessionFilePathMap,
  buildUniquePathMap,
  collectAbsolutePathsFromMessage,
  extractAbsoluteFilePathsFromText,
  isPlausibleAbsFile,
  mergePathMaps,
  suffixKeysForAbsolute,
} from "./sessionPathMap";

const ARTICLE =
  "/Users/ronglecat/Documents/document/文章输出/进行中/2026-07-24-用Grok开发一款桌面应用/04-正文/正文.md";
const OTHER =
  "/Users/ronglecat/Documents/document/文章输出/进行中/2026-06-22-codex画布标注指哪打哪/04-正文/正文.md";
const MAC_ARTICLE =
  "/Users/ronglecat/Documents/document/文章输出/进行中/2026-08-11-Mac Studio本地双模型：河南话问MES，Agent查库出图/04-正文/正文.md";
const PROJECT = "/Users/ronglecat/Documents/document/文章输出";

function toolMsg(path: string, title?: string): ChatMessage {
  return {
    id: path,
    role: "tool",
    marker: "tool_step",
    toolPath: path,
    content: `tool_step|completed|read|Read \`${title || path}\`\n${path}`,
  };
}

/** Modern host shape: file target only on `input:` (no legacy path line). */
function toolMsgInputOnly(path: string): ChatMessage {
  return {
    id: `in-${path}`,
    role: "tool",
    marker: "tool_step",
    toolInput: path,
    content: [
      "tool_step|completed|read_file|Read",
      `input:${path}`,
      "# body preview",
    ].join("\n"),
  };
}

describe("sessionPathMap", () => {
  it("suffixKeysForAbsolute includes basename and 04-正文/正文.md", () => {
    const keys = suffixKeysForAbsolute(ARTICLE, PROJECT);
    expect(keys).toContain("正文.md");
    expect(keys).toContain("04-正文/正文.md");
    expect(keys).toContain(
      "进行中/2026-07-24-用Grok开发一款桌面应用/04-正文/正文.md",
    );
    expect(keys).toContain(ARTICLE);
  });

  it("maps short token only when unique among session abs paths", () => {
    const unique = buildUniquePathMap([ARTICLE], PROJECT);
    expect(unique["正文.md"]).toBe(ARTICLE);
    expect(unique["04-正文/正文.md"]).toBe(ARTICLE);

    const ambig = buildUniquePathMap([ARTICLE, OTHER], PROJECT, {
      onAmbiguous: "unique",
    });
    expect(ambig["正文.md"]).toBeUndefined();
    expect(ambig["04-正文/正文.md"]).toBeUndefined();
    // Longer unique tails still map
    expect(
      ambig["进行中/2026-07-24-用Grok开发一款桌面应用/04-正文/正文.md"],
    ).toBe(ARTICLE);
    expect(ambig[ARTICLE]).toBe(ARTICLE);
  });

  it("onAmbiguous last prefers the most recently touched homonym", () => {
    const map = buildUniquePathMap([ARTICLE, OTHER, MAC_ARTICLE], PROJECT, {
      onAmbiguous: "last",
    });
    expect(map["正文.md"]).toBe(MAC_ARTICLE);
    expect(map["04-正文/正文.md"]).toBe(MAC_ARTICLE);
    // Distinct longer tails still unique
    expect(
      map["进行中/2026-07-24-用Grok开发一款桌面应用/04-正文/正文.md"],
    ).toBe(ARTICLE);
  });

  it("collects tool_step absolute paths", () => {
    const m = toolMsg(ARTICLE);
    expect(collectAbsolutePathsFromMessage(m)).toContain(ARTICLE);
  });

  it("collects host input: file paths (spaces in folder names)", () => {
    const m = toolMsgInputOnly(MAC_ARTICLE);
    const paths = collectAbsolutePathsFromMessage(m);
    expect(paths).toContain(MAC_ARTICLE);
    // Must not collect the space-truncated tail alone
    expect(paths.some((p) => p.endsWith("/Mac"))).toBe(false);
  });

  it("buildSessionFilePathMap resolves 04-正文/正文.md from tools", () => {
    const messages: ChatMessage[] = [
      {
        id: "a",
        role: "assistant",
        content: "源文件：`04-正文/正文.md`",
      },
      toolMsg(ARTICLE),
    ];
    const map = buildSessionFilePathMap(messages, PROJECT);
    expect(map["04-正文/正文.md"]).toBe(ARTICLE);
    expect(map["正文.md"]).toBe(ARTICLE);
  });

  it("session map prefers last toolInput when multiple 正文.md were touched", () => {
    // Style-ref read (Grok App article) then active edits on Mac Studio article.
    const messages: ChatMessage[] = [
      toolMsgInputOnly(ARTICLE),
      {
        id: "asst",
        role: "assistant",
        content: "请打开 `04-正文/正文.md` 审稿",
      },
      toolMsgInputOnly(MAC_ARTICLE),
      toolMsgInputOnly(MAC_ARTICLE),
    ];
    const map = buildSessionFilePathMap(messages, PROJECT);
    expect(map["04-正文/正文.md"]).toBe(MAC_ARTICLE);
    expect(map["正文.md"]).toBe(MAC_ARTICLE);
    expect(
      resolveFileToken("04-正文/正文.md", {
        projectPath: PROJECT,
        pathMap: map,
      }),
    ).toBe(MAC_ARTICLE);
  });

  it("extractAbsoluteFilePathsFromText keeps spaces in folder names", () => {
    const text = `路径：\n\`\`\`text\n${MAC_ARTICLE}\n\`\`\`\n也可 \`${MAC_ARTICLE}\``;
    const paths = extractAbsoluteFilePathsFromText(text);
    expect(paths).toContain(MAC_ARTICLE);
  });

  it("isPlausibleAbsFile rejects space-truncated folder tails", () => {
    expect(
      isPlausibleAbsFile(
        "/Users/ronglecat/Documents/document/文章输出/进行中/2026-08-11-Mac",
      ),
    ).toBe(false);
    expect(isPlausibleAbsFile(MAC_ARTICLE)).toBe(true);
  });

  it("collects image attachments so images/1.jpg maps in every segment", () => {
    const abs =
      "/Users/me/Library/Application Support/com.grokapp.grok-app/agent-home/sessions/abc/images/1.jpg";
    const messages: ChatMessage[] = [
      {
        id: "a",
        role: "assistant",
        content: "封面：`images/1.jpg`",
        attachments: [{ path: abs, name: "1.jpg", isDir: false }],
      },
    ];
    const paths = collectAbsolutePathsFromMessage(messages[0]!);
    expect(paths).toContain(abs);
    const map = buildSessionFilePathMap(messages, null);
    expect(map["images/1.jpg"]).toBe(abs);
    expect(map["1.jpg"]).toBe(abs);
  });

  it("mergePathMaps prefers later maps", () => {
    const m = mergePathMaps(
      { "a.md": "/tmp/a.md" },
      { "a.md": "/tmp/b.md", "b.md": "/tmp/b.md" },
    );
    expect(m["a.md"]).toBe("/tmp/b.md");
    expect(m["b.md"]).toBe("/tmp/b.md");
  });

  it("ignores non-string tool input instead of crashing chat render", () => {
    const m: ChatMessage = {
      id: "obj-input",
      role: "tool",
      marker: "tool_step",
      toolInput: { path: ARTICLE } as unknown as string,
      segments: [
        {
          kind: "tool",
          toolCallId: "t1",
          title: "Read",
          status: "completed",
          input: { path: ARTICLE } as unknown as string,
        },
      ],
      content: "tool_step|completed|read_file|Read",
    };
    expect(collectAbsolutePathsFromMessage(m)).toEqual([]);
  });

  it("collects home-relative tilde paths from assistant prose", () => {
    const tilde = "~/.grok/docs/user-guide/01-getting-started.md";
    const m: ChatMessage = {
      id: "a",
      role: "assistant",
      content: `路径：\`${tilde}\`\n\n| \`05-configuration.md\` | 配置 |`,
    };
    const paths = collectAbsolutePathsFromMessage(m);
    expect(paths).toContain(tilde);
  });

  it("maps basename from unique tilde path in session", () => {
    const tilde = "~/.grok/docs/user-guide/01-getting-started.md";
    const messages: ChatMessage[] = [
      {
        id: "a",
        role: "assistant",
        content: `路径：\`${tilde}\``,
      },
    ];
    const map = buildSessionFilePathMap(messages, null);
    expect(map["01-getting-started.md"]).toBe(tilde);
    expect(map[tilde]).toBe(tilde);
  });

  it("resolveFileToken opens sibling bare name under unique tilde parent", () => {
    const tilde = "~/.grok/docs/user-guide/01-getting-started.md";
    const map = buildSessionFilePathMap(
      [
        {
          id: "a",
          role: "assistant",
          content: `路径：\`${tilde}\``,
        },
      ],
      null,
    );
    expect(
      resolveFileToken("05-configuration.md", { pathMap: map }),
    ).toBe("~/.grok/docs/user-guide/05-configuration.md");
    expect(
      resolveFileToken("~/.grok/docs/user-guide/05-configuration.md"),
    ).toBe("~/.grok/docs/user-guide/05-configuration.md");
  });

  it("does not rematch /workspace/ inside a /Users/…/Documents/workspace path", () => {
    const dest =
      "/Users/ronglecat/Documents/workspace/grok/puppy-soda-pixel.png";
    expect(extractAbsoluteFilePathsFromText(dest)).toEqual([dest]);
    expect(
      extractAbsoluteFilePathsFromText(`Read image file: ${dest}`),
    ).toEqual([dest]);
  });

  it("extracts dest png from a live curl command toolInput", () => {
    // Live session://tool keeps title-only content + the full command on
    // toolInput. The dest path must still enter the session map so
    // `![x](puppy-soda-pixel.png)` can mount ImageUi when the turn ends.
    const dest =
      "/Users/ronglecat/Documents/workspace/grok/puppy-soda-pixel.png";
    const m: ChatMessage = {
      id: "tool-curl",
      role: "tool",
      marker: "tool_step",
      content: "Run Command",
      toolKind: "run_terminal_command",
      toolInput: `curl -L --fail --show-error -o "${dest}" "https://cdn.example/x.png"`,
    };
    expect(collectAbsolutePathsFromMessage(m)).toContain(dest);
    expect(
      buildSessionFilePathMap([m], "/Users/ronglecat/Documents/workspace/grok")[
        "puppy-soda-pixel.png"
      ],
    ).toBe(dest);
  });

  it("maps markdown basename from live assistant tool segments (curl input)", () => {
    const dest =
      "/Users/ronglecat/Documents/workspace/grok/kitten-watermelon-pixel.png";
    const messages: ChatMessage[] = [
      {
        id: "a",
        role: "assistant",
        content: "![小猫](kitten-watermelon-pixel.png)",
        segments: [
          {
            kind: "tool",
            toolCallId: "t-curl",
            title: "Run Command",
            toolKind: "run_terminal_command",
            status: "completed",
            input: `mkdir -p "/Users/ronglecat/Documents/workspace/grok" && curl -L -o "${dest}" "https://cdn.example/k.png"`,
          },
        ],
      },
    ];
    const map = buildSessionFilePathMap(
      messages,
      "/Users/ronglecat/Documents/workspace/grok",
    );
    expect(map["kitten-watermelon-pixel.png"]).toBe(dest);
  });

  it("session 60b14957 journal shape maps relative markdown image via later tool_step", () => {
    const dest =
      "/Users/ronglecat/Documents/workspace/grok/puppy-soda-pixel.png";
    const messages: ChatMessage[] = [
      {
        id: "asst",
        role: "assistant",
        content: [
          "像素风小狗喝汽水已经生成。",
          "",
          "![小狗喝汽水像素风](puppy-soda-pixel.png)",
          "",
          "| 本地文件 | `puppy-soda-pixel.png` |",
        ].join("\n"),
      },
      {
        id: "tool-call-read",
        role: "tool",
        marker: "tool_step",
        content: [
          "tool_step|completed|read_file|Read",
          `input:${dest}`,
          `Read image file: ${dest}`,
        ].join("\n"),
      },
    ];
    const map = buildSessionFilePathMap(
      messages,
      "/Users/ronglecat/Documents/workspace/grok",
    );
    expect(map["puppy-soda-pixel.png"]).toBe(dest);
  });
});
