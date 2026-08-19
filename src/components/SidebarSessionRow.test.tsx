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
  planPendingAria: "Plan awaiting review",
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
  untitled: "Untitled",
  renameLabel: "Rename chat",
  renamePlaceholder: "Chat title",
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
        onRename: vi.fn(),
      }),
    );
    expect(html).toContain("tree-l3");
    expect(html).toContain("tree-l3--active");
    expect(html).toContain("Hello chat");
    expect(html).toContain("tree-l3--unread");
    expect(html).toContain("data-session-id=\"s1\"");
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
        onRename: vi.fn(),
      }),
    );
    expect(html).toContain("tree-l3--orphan");
    expect(html).toContain("tree-l3--working");
  });

  it("shows plan-pending badge without changing working/unread chrome", () => {
    const html = renderToString(
      React.createElement(SidebarSessionRow, {
        session: { id: "s3", title: "Needs plan review" },
        variant: "project",
        active: false,
        working: false,
        unread: false,
        planPending: true,
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
        onRename: vi.fn(),
      }),
    );
    expect(html).toContain("tree-l3--plan-pending");
    expect(html).toContain("sidebar-session-plan-pending");
    expect(html).toContain("Plan awaiting review");
    // Actions stay available (not replaced by spinner) when not working.
    expect(html).toContain("tree-l3__actions");
  });

  it("uses untitled fallback and does not render a rename field at rest", () => {
    const html = renderToString(
      React.createElement(SidebarSessionRow, {
        session: { id: "s4", title: "" },
        variant: "project",
        active: false,
        working: false,
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
        onRename: vi.fn(),
      }),
    );
    expect(html).toContain("Untitled");
    expect(html).not.toContain("sidebar-session-rename");
    expect(html).not.toContain("tree-l3--renaming");
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
