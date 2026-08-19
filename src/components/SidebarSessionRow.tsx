/**
 * Memoized sidebar session row (project tree + orphan history).
 * Keeps row UI out of App so stream re-renders skip unchanged rows.
 */

import {
  memo,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { nextSessionTitle } from "@/lib/sidebarSessionRename";
import type { Locale } from "@/i18n";
import {
  IconArchive,
  IconBellOff,
  IconChat,
  IconCheck,
  IconClock,
  IconMore,
  IconNotes,
  IconPin,
  IconPinOff,
  IconPlan,
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
  /** Plan review / re-park pending — decorative only. */
  planPendingAria: string;
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
  untitled: string;
  renameLabel: string;
  renamePlaceholder: string;
  attach?: string;
};

export type SidebarSessionRowProps = {
  session: SidebarSessionRowSession;
  variant: "project" | "orphan";
  active: boolean;
  working: boolean;
  unread: boolean;
  /**
   * Plan awaiting user approve / re-park. Pure badge — does not change row
   * click, busy spinner, or select-mode behavior.
   */
  planPending?: boolean;
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
  /**
   * Select-mode click / Space / Enter.
   * `shiftKey` enables contiguous range select from the last anchor.
   */
  onToggleSelect: (
    sessionId: string,
    opts?: { shiftKey?: boolean },
  ) => void;
  onPin: (session: SidebarSessionRowSession) => void;
  onArchive: (session: SidebarSessionRowSession) => void;
  onMenu: (e: MouseEvent, session: SidebarSessionRowSession) => void;
  /** Persist a committed in-row title (already trimmed, non-empty, changed). */
  onRename: (session: SidebarSessionRowSession, title: string) => void;
  /** Attach this row to the current composer (icon button). */
  onAttach?: (session: SidebarSessionRowSession) => void;
};

function SidebarSessionRowInner({
  session,
  variant,
  active,
  working,
  unread,
  planPending = false,
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
  onRename,
  onAttach,
}: SidebarSessionRowProps) {
  const displayTitle = session.title || labels.untitled;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const editingRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const className =
    (variant === "orphan" ? "tree-l3 tree-l3--orphan" : "tree-l3") +
    (active ? " tree-l3--active" : "") +
    (variant === "project" && session.archived ? " tree-l3--archived" : "") +
    (working ? " tree-l3--working" : "") +
    (unread ? " tree-l3--unread" : "") +
    (planPending ? " tree-l3--plan-pending" : "") +
    (selectMode ? " tree-l3--select-mode" : "") +
    (checked ? " tree-l3--checked" : "") +
    (editing ? " tree-l3--renaming" : "");

  const closeRename = (commit: boolean) => {
    if (!editingRef.current) return;
    editingRef.current = false;
    setEditing(false);
    if (!commit) return;
    const next = nextSessionTitle(draft, displayTitle);
    if (!next) return;
    onRename(session, next);
  };

  const beginRename = () => {
    if (selectMode || editingRef.current) return;
    editingRef.current = true;
    setDraft(displayTitle);
    setEditing(true);
  };

  useLayoutEffect(() => {
    if (!selectMode || !editingRef.current) return;
    editingRef.current = false;
    setEditing(false);
  }, [selectMode]);

  useLayoutEffect(() => {
    if (!editing) return;
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, [editing]);

  /**
   * Double-click starts in-row rename. The first click of the pair still
   * opens the chat — delaying onOpen would make single-click feel laggy.
   * `detail > 1` skips the extra click so open is not invoked twice.
   */
  const handleClick = (e: MouseEvent) => {
    if (editingRef.current) return;
    if (e.detail > 1) return;
    if (selectMode) {
      onToggleSelect(session.id, { shiftKey: e.shiftKey });
      return;
    }
    onOpen(session);
  };

  const handleDoubleClick = (e: MouseEvent) => {
    if (selectMode) return;
    e.preventDefault();
    e.stopPropagation();
    beginRename();
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (editingRef.current) return;
    if (e.key === "F2" && !selectMode) {
      e.preventDefault();
      beginRename();
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      if (selectMode) {
        e.preventDefault();
        onToggleSelect(session.id, { shiftKey: e.shiftKey });
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
  // Keep the attach icon out of the hover overlay so it is not covered
  // by pin/archive/menu. Hide on the open row (cannot attach self).
  const showAttach = !!onAttach && !!labels.attach && !selectMode && !working && !active;

  const menuButton = (
    <button
      type="button"
      className="tree-icon-btn"
      onClick={(e) => onMenu(e, session)}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <IconMore size={13} />
    </button>
  );

  return (
    <div
      className={className}
      data-session-id={session.id}
      role="button"
      tabIndex={0}
      aria-checked={selectMode ? checked : undefined}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onContextMenu={(e) => onContextMenu(e, session)}
      onKeyDown={handleKeyDown}
      draggable={false}
      onDragStart={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      {selectMode ? (
        <span
          className={"tree-l3__check" + (checked ? " is-on" : "")}
          aria-hidden
        >
          {checked ? <IconCheck size={11} stroke={2.4} /> : null}
        </span>
      ) : null}
      {showAttach ? (
        <span className="tree-l3__attach-tools">
          <Tip label={labels.attach}>
            <button
              type="button"
              className="tree-icon-btn tree-l3__attach-btn"
              aria-label={labels.attach}
              data-testid="sidebar-session-attach"
              onClick={(e) => {
                e.stopPropagation();
                onAttach?.(session);
              }}
            >
              <IconChat size={13} />
            </button>
          </Tip>
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
        {planPending ? (
          <span
            className="tree-l3__plan-pending"
            title={labels.planPendingAria}
            aria-label={labels.planPendingAria}
            data-testid="sidebar-session-plan-pending"
          >
            <IconPlan size={12} aria-hidden />
          </span>
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
        {editing ? (
          <input
            ref={inputRef}
            className="tree-l3__rename"
            value={draft}
            aria-label={labels.renameLabel}
            placeholder={labels.renamePlaceholder}
            spellCheck={false}
            autoComplete="off"
            data-no-session-move=""
            data-testid="sidebar-session-rename"
            onChange={(e) => setDraft(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.nativeEvent.isComposing || e.key === "Process") return;
              if (e.key === "Enter") {
                e.preventDefault();
                closeRename(true);
              } else if (e.key === "Escape") {
                e.preventDefault();
                closeRename(false);
              }
            }}
            onBlur={() => closeRename(true)}
          />
        ) : (
          <SidebarSessionName title={displayTitle} />
        )}
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
              onDoubleClick={(e) => e.stopPropagation()}
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
              onDoubleClick={(e) => e.stopPropagation()}
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
    prev.planPending === next.planPending &&
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
    prev.onRename === next.onRename &&
    prev.onAttach === next.onAttach &&
    worktreeBadgeEqual(prev.worktreeBadge, next.worktreeBadge)
  );
}

export const SidebarSessionRow = memo(
  SidebarSessionRowInner,
  sidebarSessionRowPropsEqual,
);
