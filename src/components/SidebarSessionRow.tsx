/**
 * Memoized sidebar session row (project tree + orphan history).
 * Keeps row UI out of App so stream re-renders skip unchanged rows.
 */

import { memo, type KeyboardEvent, type MouseEvent } from "react";
import type { Locale } from "@/i18n";
import {
  IconArchive,
  IconBellOff,
  IconCheck,
  IconClock,
  IconMore,
  IconNotes,
  IconPin,
  IconPinOff,
} from "@/components/icons";
import { Spinner } from "@/components/ui/spinner";
import { Tip } from "@/components/ui/tooltip";
import { SidebarSessionName } from "@/components/SidebarSessionName";
import { SidebarSessionRelativeTime } from "@/components/SidebarSessionRelativeTime";

export type SidebarSessionRowSession = {
  id: string;
  title: string;
  pinned?: boolean;
  archived?: boolean;
  scheduled?: boolean;
  updatedAt?: string;
};

export type SidebarSessionWorktreeBadgeProp = {
  label: string;
  branch: string | null;
  layoutKind: "cli" | "sibling" | "other";
  /** Pre-translated tooltip body. */
  title: string;
  /** Pre-translated aria-label. */
  ariaLabel: string;
};

/** Plain strings already translated by the parent (row does not call tr()). */
export type SidebarSessionRowLabels = {
  unreadAria: string;
  pinned: string;
  muted: string;
  noteAria: string;
  automationsTag: string;
  working: string;
  pin: string;
  unpin: string;
  archive: string;
  unarchive: string;
  menu: string;
};

export type SidebarSessionRowProps = {
  session: SidebarSessionRowSession;
  variant: "project" | "orphan";
  active: boolean;
  working: boolean;
  unread: boolean;
  checked: boolean;
  selectMode: boolean;
  muted: boolean;
  /** Non-null when session has a note; used as title (+ falls back to noteAria). */
  noteTitle: string | null;
  worktreeBadge: SidebarSessionWorktreeBadgeProp | null;
  labels: SidebarSessionRowLabels;
  locale: Locale;
  showRelativeTime: boolean;
  /** Prefer stable useCallbacks from App (session-parameterized). */
  onOpen: (session: SidebarSessionRowSession) => void;
  onContextMenu: (e: MouseEvent, session: SidebarSessionRowSession) => void;
  onToggleSelect: (sessionId: string) => void;
  onPin: (session: SidebarSessionRowSession) => void;
  onArchive: (session: SidebarSessionRowSession) => void;
  onMenu: (e: MouseEvent, session: SidebarSessionRowSession) => void;
};

function SidebarSessionRowInner({
  session,
  variant,
  active,
  working,
  unread,
  checked,
  selectMode,
  muted,
  noteTitle,
  worktreeBadge,
  labels,
  locale,
  showRelativeTime,
  onOpen,
  onContextMenu,
  onToggleSelect,
  onPin,
  onArchive,
  onMenu,
}: SidebarSessionRowProps) {
  const className =
    (variant === "orphan" ? "tree-l3 tree-l3--orphan" : "tree-l3") +
    (active ? " tree-l3--active" : "") +
    (variant === "project" && session.archived ? " tree-l3--archived" : "") +
    (working ? " tree-l3--working" : "") +
    (unread ? " tree-l3--unread" : "") +
    (selectMode ? " tree-l3--select-mode" : "") +
    (checked ? " tree-l3--checked" : "");

  const handleClick = () => {
    if (selectMode) {
      onToggleSelect(session.id);
      return;
    }
    onOpen(session);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      if (selectMode) {
        e.preventDefault();
        onToggleSelect(session.id);
        return;
      }
      if (e.key === "Enter") onOpen(session);
    }
  };

  const pinLabel = session.pinned ? labels.unpin : labels.pin;
  // Project rows toggle archive tip; orphans always show "archive" (legacy).
  const archiveLabel =
    variant === "project" && session.archived
      ? labels.unarchive
      : labels.archive;

  const menuButton = (
    <button
      type="button"
      className="tree-icon-btn"
      onClick={(e) => onMenu(e, session)}
    >
      <IconMore size={13} />
    </button>
  );

  return (
    <div
      className={className}
      role="button"
      tabIndex={0}
      aria-checked={selectMode ? checked : undefined}
      onClick={handleClick}
      onContextMenu={(e) => onContextMenu(e, session)}
      onKeyDown={handleKeyDown}
    >
      {selectMode ? (
        <span
          className={"tree-l3__check" + (checked ? " is-on" : "")}
          aria-hidden
        >
          {checked ? <IconCheck size={11} stroke={2.4} /> : null}
        </span>
      ) : null}
      <span className="tree-l3__title">
        {unread ? (
          <span
            className="tree-l3__unread"
            title={labels.unreadAria}
            aria-label={labels.unreadAria}
          />
        ) : null}
        {session.pinned ? (
          <span
            className="tree-l3__kind"
            title={labels.pinned}
            aria-label={labels.pinned}
          >
            <IconPin size={12} className="tree-l3__pin" />
          </span>
        ) : null}
        {muted ? (
          <span
            className="tree-l3__kind tree-l3__muted"
            title={labels.muted}
            aria-label={labels.muted}
          >
            <IconBellOff size={12} />
          </span>
        ) : null}
        {noteTitle ? (
          <span
            className="tree-l3__kind"
            title={noteTitle}
            aria-label={labels.noteAria}
          >
            <IconNotes size={12} />
          </span>
        ) : null}
        {session.scheduled ? (
          <span
            className="tree-l3__kind"
            title={labels.automationsTag}
            aria-label={labels.automationsTag}
          >
            <IconClock size={13} />
          </span>
        ) : null}
        {worktreeBadge ? (
          <span
            className={
              "tree-l3__wt" +
              (worktreeBadge.layoutKind === "cli"
                ? " tree-l3__wt--cli"
                : worktreeBadge.layoutKind === "sibling"
                  ? " tree-l3__wt--sibling"
                  : "")
            }
            title={worktreeBadge.title}
            aria-label={worktreeBadge.ariaLabel}
          >
            {worktreeBadge.label}
          </span>
        ) : null}
        <SidebarSessionName title={session.title || "Untitled"} />
      </span>
      <SidebarSessionRelativeTime
        updatedAt={session.updatedAt}
        locale={locale}
        enabled={showRelativeTime}
      />
      {selectMode ? null : working ? (
        <Tip label={labels.working}>
          <span className="tree-l3__status" aria-label={labels.working}>
            <Spinner size={14} className="tree-l3__spinner" />
          </span>
        </Tip>
      ) : (
        <span className="tree-l3__actions tree-l3__actions--triple">
          <Tip label={pinLabel}>
            <button
              type="button"
              className="tree-icon-btn"
              onClick={(e) => {
                e.stopPropagation();
                onPin(session);
              }}
            >
              {session.pinned ? (
                <IconPinOff size={13} />
              ) : (
                <IconPin size={13} />
              )}
            </button>
          </Tip>
          <Tip label={archiveLabel}>
            <button
              type="button"
              className="tree-icon-btn"
              onClick={(e) => {
                e.stopPropagation();
                onArchive(session);
              }}
            >
              <IconArchive size={13} />
            </button>
          </Tip>
          {variant === "project" ? (
            <Tip label={labels.menu}>{menuButton}</Tip>
          ) : (
            menuButton
          )}
        </span>
      )}
    </div>
  );
}

function worktreeBadgeEqual(
  a: SidebarSessionWorktreeBadgeProp | null,
  b: SidebarSessionWorktreeBadgeProp | null,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.label === b.label &&
    a.branch === b.branch &&
    a.layoutKind === b.layoutKind &&
    a.title === b.title &&
    a.ariaLabel === b.ariaLabel
  );
}

function sidebarSessionRowPropsEqual(
  prev: SidebarSessionRowProps,
  next: SidebarSessionRowProps,
): boolean {
  return (
    prev.session.id === next.session.id &&
    prev.session.title === next.session.title &&
    prev.session.pinned === next.session.pinned &&
    prev.session.archived === next.session.archived &&
    prev.session.scheduled === next.session.scheduled &&
    prev.session.updatedAt === next.session.updatedAt &&
    prev.variant === next.variant &&
    prev.active === next.active &&
    prev.working === next.working &&
    prev.unread === next.unread &&
    prev.checked === next.checked &&
    prev.selectMode === next.selectMode &&
    prev.muted === next.muted &&
    prev.noteTitle === next.noteTitle &&
    prev.locale === next.locale &&
    prev.showRelativeTime === next.showRelativeTime &&
    prev.labels === next.labels &&
    prev.onOpen === next.onOpen &&
    prev.onContextMenu === next.onContextMenu &&
    prev.onToggleSelect === next.onToggleSelect &&
    prev.onPin === next.onPin &&
    prev.onArchive === next.onArchive &&
    prev.onMenu === next.onMenu &&
    worktreeBadgeEqual(prev.worktreeBadge, next.worktreeBadge)
  );
}

export const SidebarSessionRow = memo(
  SidebarSessionRowInner,
  sidebarSessionRowPropsEqual,
);
