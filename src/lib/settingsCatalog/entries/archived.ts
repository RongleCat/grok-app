import type { SettingsEntry } from "../types";

/** Settings catalog entries — archived section. */
export const ARCHIVED_ENTRIES: readonly SettingsEntry[] = [
  // ── archived ──
  {
    id: "archived.list",
    section: "archived",
    anchorId: "settings-anchor-archived",
    labelKey: "settings.nav.archived",
    descKeys: [
      "settings.archived.desc",
      "settings.archived.empty",
      "settings.archived.restore",
      "settings.archived.delete",
      "settings.archived.selectAll",
    ],
    keywords: [
      "archive",
      "archived chats",
      "归档",
      "歸檔",
      "已归档会话",
      "已歸檔會話",
      "存档",
      "存檔",
    ],
  },
  {
    id: "archived.archiveOlder",
    section: "archived",
    anchorId: "settings-anchor-archive-older",
    labelKey: "settings.archived.archiveOlder",
    descKeys: [
      "settings.archived.archiveOlderDesc",
      "settings.archived.archiveOlderMatchHint",
      "settings.archived.archiveOlderNoneHint",
    ],
    keywords: [
      "archive older",
      "bulk archive",
      "archive by age",
      "preview count",
      "old chats",
      "7 days",
      "30 days",
      "90 days",
      "归档超过",
      "按时间归档",
      "封存超過",
    ],
  },
];
