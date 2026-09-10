import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  WHATS_NEW_FIRST_SEEN_KEY,
  WHATS_NEW_SEEN_KEY,
  changelogLang,
  changelogPopupItem,
  ensureFirstSeenVersion,
  firstSentence,
  loadSeenVersion,
  markWhatsNewSeen,
  parseChangelogNotes,
  shouldAutoShowWhatsNew,
  type WhatsNewStorage,
} from "./whatsNew";

const FIXTURE = `# Changelog

## [Unreleased]

### Added
- **Dev only**: should not be picked for 1.2.3

**中文 · 新增**
- **仅开发**：不该出现在 1.2.3

## [1.2.3] - 2026-08-01

> **Highlight:** Fast cats.
>
> **中文 · 亮点：** 快猫。

### Added
- **Cat zoom**: Cats zoom now.

**中文 · 新增**
- **猫咪变焦**：猫咪会变焦了。

### Changed
- **Windows paths**: Strip prefixes.

**中文 · 变更**
- **Windows 路径**：去掉前缀。

### Fixed
- **Crash**: No more crash.

**中文 · 修复**
- **崩溃**：不再崩溃。

## [1.2.2] - 2026-07-01

### Added
- **Old**: leftover.

**中文 · 新增**
- **旧**：残留。
`;

function memoryStorage(
  initial: Record<string, string> = {},
): WhatsNewStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem(key) {
      return key in data ? data[key]! : null;
    },
    setItem(key, value) {
      data[key] = value;
    },
    removeItem(key) {
      delete data[key];
    },
  };
}

describe("parseChangelogNotes", () => {
  it("extracts English highlight and sections for a version", () => {
    const notes = parseChangelogNotes(FIXTURE, "1.2.3", "en");
    expect(notes).not.toBeNull();
    expect(notes?.version).toBe("1.2.3");
    expect(notes?.date).toBe("2026-08-01");
    expect(notes?.highlight).toBe("Fast cats.");
    expect(notes?.sections.map((s) => s.id)).toEqual([
      "added",
      "changed",
      "fixed",
    ]);
    expect(notes?.sections[0]?.items).toEqual(["Cat zoom"]);
    expect(notes?.sections[1]?.items[0]).toBe("Windows paths");
    expect(notes?.sections[2]?.items[0]).toBe("Crash");
    expect(notes?.sections.flatMap((s) => s.items).join(" ")).not.toContain(
      "Dev only",
    );
  });

  it("extracts Chinese highlight and sections for zh catalogs", () => {
    const notes = parseChangelogNotes(FIXTURE, "1.2.3", "zh");
    expect(notes?.highlight).toBe("快猫。");
    expect(notes?.sections[0]?.items).toEqual(["猫咪变焦"]);
    expect(notes?.sections[1]?.items[0]).toBe("Windows 路径");
    expect(notes?.sections[2]?.items[0]).toBe("崩溃");
  });

  it("returns null when the version section is missing", () => {
    expect(parseChangelogNotes(FIXTURE, "9.9.9", "en")).toBeNull();
  });

  it("reads the whole section even when a capital Z appears mid-body", () => {
    const md = [
      "## [1.2.4] - 2026-09-01",
      "",
      "### Fixed",
      "- Zoom hotkeys work again.",
      "- ZDR wallpaper blocks show a hint.",
      "- Windows tray quits cleanly.",
      "",
      "**中文 · 修复**",
      "- 缩放快捷键恢复。",
      "",
      "## [1.2.3]",
      "",
      "### Fixed",
      "- Older entry.",
    ].join("\n");
    const notes = parseChangelogNotes(md, "1.2.4", "en");
    expect(notes?.sections[0]?.items).toEqual([
      "Zoom hotkeys work again.",
      "ZDR wallpaper blocks show a hint.",
      "Windows tray quits cleanly.",
    ]);
    const zh = parseChangelogNotes(md, "1.2.4", "zh");
    expect(zh?.sections[0]?.items).toEqual(["缩放快捷键恢复。"]);
  });
});

describe("changelogPopupItem", () => {
  it("keeps only the first sentence", () => {
    expect(
      changelogPopupItem(
        "- Chat can render LaTeX. KaTeX for `$…$`, matching Grok Build CLI.",
      ),
    ).toBe("Chat can render LaTeX.");
    expect(
      changelogPopupItem(
        "- 对话支持 LaTeX 公式。KaTeX 渲染 `$…$`，与 Grok Build CLI 一致。",
      ),
    ).toBe("对话支持 LaTeX 公式。");
  });

  it("does not split version-like decimals", () => {
    expect(
      changelogPopupItem(
        "- OpenRouter preset is now GLM-5.3 Flash. Saved channels stay until re-added.",
      ),
    ).toBe("OpenRouter preset is now GLM-5.3 Flash.");
  });

  it("uses the leading bold title and drops issue numbers", () => {
    expect(
      changelogPopupItem(
        "- **Windows Open in editor no longer hands VS Code paths (#928)**: strips `\\\\?\\`.",
      ),
    ).toBe("Windows Open in editor no longer hands VS Code paths");
    expect(
      changelogPopupItem(
        "- **从账户导入 Grok Build CLI 对话**到侧栏；空侧栏在有本地记录时提供同一入口。",
      ),
    ).toBe("从账户导入 Grok Build CLI 对话");
  });

  it("drops fullwidth issue parens instead of leaving () or (,)", () => {
    expect(
      changelogPopupItem(
        "- **「上下文已自动压缩」卡片留在压缩发生的时间点（#855）**：后续工具不再堆到输入框。",
      ),
    ).toBe("「上下文已自动压缩」卡片留在压缩发生的时间点");
    expect(
      changelogPopupItem(
        "- **Windows 权限卡点击无响应（#878, #880）**：按钮可点。",
      ),
    ).toBe("Windows 权限卡点击无响应");
    expect(
      changelogPopupItem("- 长会话上下滚动卡死（#881、#882）。再写一句补充。"),
    ).toBe("长会话上下滚动卡死。");
  });
});

describe("firstSentence", () => {
  it("returns the whole string when there is no terminator", () => {
    expect(firstSentence("Settings overlay opacity")).toBe(
      "Settings overlay opacity",
    );
  });
});

describe("changelogLang", () => {
  it("uses Chinese CHANGELOG blocks for zh and zh-TW only", () => {
    expect(changelogLang("zh")).toBe("zh");
    expect(changelogLang("zh-TW")).toBe("zh");
    expect(changelogLang("en")).toBe("en");
    expect(changelogLang("ja")).toBe("en");
    expect(changelogLang("de")).toBe("en");
  });
});

describe("whatsNew seen / auto-show", () => {
  it("round-trips seen version", () => {
    const s = memoryStorage();
    expect(loadSeenVersion(s)).toBeNull();
    markWhatsNewSeen("1.2.3", s);
    expect(s.data[WHATS_NEW_SEEN_KEY]).toBe("1.2.3");
    expect(loadSeenVersion(s)).toBe("1.2.3");
  });

  it("records first-seen version once", () => {
    const s = memoryStorage();
    expect(ensureFirstSeenVersion("1.2.3", s)).toBe("1.2.3");
    expect(s.data[WHATS_NEW_FIRST_SEEN_KEY]).toBe("1.2.3");
    expect(ensureFirstSeenVersion("1.2.4", s)).toBe("1.2.3");
  });

  it("does not auto-show during setup, tutorial, or before the gate", () => {
    expect(
      shouldAutoShowWhatsNew({
        currentVersion: "1.2.3",
        seenVersion: null,
        firstSeenVersion: "1.0.0",
        gateReady: false,
        setupOpen: false,
        tutorialOpen: false,
      }),
    ).toBe(false);
    expect(
      shouldAutoShowWhatsNew({
        currentVersion: "1.2.3",
        seenVersion: null,
        firstSeenVersion: "1.0.0",
        gateReady: true,
        setupOpen: true,
        tutorialOpen: false,
      }),
    ).toBe(false);
    expect(
      shouldAutoShowWhatsNew({
        currentVersion: "1.2.3",
        seenVersion: null,
        firstSeenVersion: "1.0.0",
        gateReady: true,
        setupOpen: false,
        tutorialOpen: true,
      }),
    ).toBe(false);
  });

  it("does not auto-show a fresh install of the current version", () => {
    expect(
      shouldAutoShowWhatsNew({
        currentVersion: "1.2.3",
        seenVersion: null,
        firstSeenVersion: "1.2.3",
        gateReady: true,
        setupOpen: false,
        tutorialOpen: false,
      }),
    ).toBe(false);
  });

  it("auto-shows an upgrade from a previous version", () => {
    expect(
      shouldAutoShowWhatsNew({
        currentVersion: "1.2.4",
        seenVersion: "1.2.3",
        firstSeenVersion: "1.2.3",
        gateReady: true,
        setupOpen: false,
        tutorialOpen: false,
      }),
    ).toBe(true);
  });

  it("auto-shows a legacy install that never recorded first-seen", () => {
    expect(
      shouldAutoShowWhatsNew({
        currentVersion: "1.2.3",
        seenVersion: null,
        firstSeenVersion: null,
        gateReady: true,
        setupOpen: false,
        tutorialOpen: false,
      }),
    ).toBe(true);
  });

  it("does not auto-show the same version twice", () => {
    expect(
      shouldAutoShowWhatsNew({
        currentVersion: "1.2.3",
        seenVersion: "1.2.3",
        firstSeenVersion: "1.0.0",
        gateReady: true,
        setupOpen: false,
        tutorialOpen: false,
      }),
    ).toBe(false);
  });
});

describe("shipped CHANGELOG.md", () => {
  const md = readFileSync(resolve(__dirname, "../../CHANGELOG.md"), "utf8");
  const pkg = JSON.parse(
    readFileSync(resolve(__dirname, "../../package.json"), "utf8"),
  ) as { version: string };

  it("has a section for the package version or Unreleased notes", () => {
    const notes =
      parseChangelogNotes(md, pkg.version, "en") ??
      parseChangelogNotes(md, "Unreleased", "en");
    expect(notes).not.toBeNull();
    expect((notes?.sections.length ?? 0) + (notes?.highlight ? 1 : 0)).toBeGreaterThan(
      0,
    );
  });

  it("does not put CHANGELOG detail sentences into the 0.2.26 popup", () => {
    const notes = parseChangelogNotes(md, "0.2.26", "en");
    const first = notes?.sections.find((s) => s.id === "added")?.items[0];
    expect(first).toBe(
      "Import Grok Build CLI sessions from Account → Recent sessions",
    );
    expect(first).not.toContain("untrusted");
  });

  it("does not leave empty issue parentheses on 0.2.26 Chinese notes", () => {
    const zh = parseChangelogNotes(md, "0.2.26", "zh");
    const items = zh?.sections.flatMap((s) => s.items) ?? [];
    expect(items.some((item) => item.includes("上下文已自动压缩"))).toBe(true);
    for (const item of items) {
      expect(item).not.toMatch(/[(（]\s*[,，、]?\s*[)）]/);
      expect(item).not.toMatch(/#[0-9]/);
    }
  });

  it("keeps Unreleased popup lines to one short sentence", () => {
    const notes = parseChangelogNotes(md, "Unreleased", "en");
    const zh = parseChangelogNotes(md, "Unreleased", "zh");
    const items = [
      ...(notes?.highlight ? [notes.highlight] : []),
      ...(notes?.sections.flatMap((s) => s.items) ?? []),
      ...(zh?.highlight ? [zh.highlight] : []),
      ...(zh?.sections.flatMap((s) => s.items) ?? []),
    ];
    // Empty Unreleased is expected after cutting a version section.
    if (items.length === 0) return;
    expect(notes?.sections.map((s) => s.items.length)).toEqual(
      zh?.sections.map((s) => s.items.length),
    );
    for (const item of items) {
      expect(item.length).toBeLessThanOrEqual(90);
      expect(item).not.toMatch(/\s#[0-9]+\b/);
    }
  });
});
