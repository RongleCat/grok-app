import { describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import React from "react";
import {
  SidebarSessionRow,
  type SidebarSessionRowLabels,
} from "@/components/SidebarSessionRow";
import { SidebarSessionRelativeTime } from "@/components/SidebarSessionRelativeTime";

const labels: SidebarSessionRowLabels = {
  unreadAria: "Unread",
  pinned: "Pinned",
  muted: "Muted",
  noteAria: "Note",
  automationsTag: "Automation",
  working: "Working",
  pin: "Pin",
  unpin: "Unpin",
  archive: "Archive",
  unarchive: "Unarchive",
  menu: "Menu",
};

describe("SidebarSessionRow", () => {
  it("exports and renders a project session row", () => {
    const html = renderToString(
      React.createElement(SidebarSessionRow, {
        session: {
          id: "s1",
          title: "Hello chat",
          pinned: true,
          updatedAt: new Date().toISOString(),
        },
        variant: "project",
        active: true,
        working: false,
        unread: true,
        checked: false,
        selectMode: false,
        muted: false,
        noteTitle: null,
        worktreeBadge: null,
        labels,
        locale: "en",
        showRelativeTime: false,
        onOpen: vi.fn(),
        onContextMenu: vi.fn(),
        onToggleSelect: vi.fn(),
        onPin: vi.fn(),
        onArchive: vi.fn(),
        onMenu: vi.fn(),
      }),
    );
    expect(html).toContain("tree-l3");
    expect(html).toContain("tree-l3--active");
    expect(html).toContain("Hello chat");
    expect(html).toContain("tree-l3--unread");
  });

  it("renders orphan variant class", () => {
    const html = renderToString(
      React.createElement(SidebarSessionRow, {
        session: { id: "s2", title: "Orphan" },
        variant: "orphan",
        active: false,
        working: true,
        unread: false,
        checked: false,
        selectMode: false,
        muted: false,
        noteTitle: null,
        worktreeBadge: null,
        labels,
        locale: "en",
        showRelativeTime: false,
        onOpen: vi.fn(),
        onContextMenu: vi.fn(),
        onToggleSelect: vi.fn(),
        onPin: vi.fn(),
        onArchive: vi.fn(),
        onMenu: vi.fn(),
      }),
    );
    expect(html).toContain("tree-l3--orphan");
    expect(html).toContain("tree-l3--working");
  });
});

describe("SidebarSessionRelativeTime", () => {
  it("returns empty when disabled", () => {
    const html = renderToString(
      React.createElement(SidebarSessionRelativeTime, {
        updatedAt: new Date().toISOString(),
        locale: "en",
        enabled: false,
      }),
    );
    expect(html).toBe("");
  });

  it("returns empty when no updatedAt", () => {
    const html = renderToString(
      React.createElement(SidebarSessionRelativeTime, {
        updatedAt: undefined,
        locale: "en",
        enabled: true,
      }),
    );
    expect(html).toBe("");
  });
});
