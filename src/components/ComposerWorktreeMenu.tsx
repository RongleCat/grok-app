/**
 * Composer branch / worktree chip — switch linked worktrees, create, remove, GC.
 * Also lists Grok Build CLI-tracked worktrees (`grok worktree list`) and, when a
 * pull request is bound to the current branch, the PR monitor (banded to the
 * branch: number + truncated title, watch toggle, open in the PR hub).
 * Lives next to the project picker on the new-session context bar.
 */

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import {
  IconBell,
  IconBellOff,
  IconCheck,
  IconFileDiff,
  IconFolder,
  IconGitBranch,
  IconPlus,
  IconRefresh,
  IconTrash,
  IconUpload,
} from "@/components/icons";
import { Tip } from "@/components/ui/tooltip";
import { useFloatingMenu } from "@/lib/floatingMenu";
import {
  canOpenCliWorktreeAsCwd,
  cliWorktreeMetaLabel,
} from "@/lib/cliWorktrees";
import {
  branchCheckedOutElsewhere,
  capGitBranchesForMenu,
  filterGitBranches,
  sortGitBranches,
  type GitBranchEntry,
} from "@/lib/gitBranches";
import {
  canRemoveWorktree,
  pathsEqual,
  worktreeLabel,
} from "@/lib/gitWorktree";
import {
  PR_CHIP_TITLE_MAX,
  PR_MENU_TITLE_MAX,
  formatPrChipLabel,
  truncatePrTitle,
} from "@/lib/prMonitor";
import type { CliWorktreeEntry, GitWorktreeEntry } from "@/lib/api";

export type ComposerWorktreeMenuLabels = {
  worktrees: string;
  worktreesEmpty: string;
  worktreesUnavailable: string;
  worktreesLoading?: string;
  worktreeCurrent: string;
  worktreeMain: string;
  worktreeDetached: string;
  /** Trigger tip / aria. */
  worktreeTip: string;
  worktreeNew: string;
  worktreeNewChat: string;
  worktreeGc: string;
  /** Push branch + open PR (worktree ship flow). */
  worktreeShip?: string;
  worktreeShipTip?: string;
  /** Compare current linked worktree vs main (diff list only). */
  worktreeCompare?: string;
  worktreeCompareTip?: string;
  /** Per-row remove control (non-main only). */
  worktreeRemove?: string;
  worktreeRemoveTip?: string;
  /** CLI-tracked worktrees section (`grok worktree list`). */
  cliWorktrees?: string;
  cliWorktreesEmpty?: string;
  cliWorktreesUnavailable?: string;
  cliWorktreesLoading?: string;
  cliWorktreeRefresh?: string;
  cliWorktreeReveal?: string;
  cliWorktreeOpen?: string;
  cliWorktreeOpenUnavailable?: string;
  cliWorktreeMissingPath?: string;
  /** In-place git branch list (same working tree). */
  branches?: string;
  branchesEmpty?: string;
  branchesUnavailable?: string;
  branchesLoading?: string;
  branchesSearchPlaceholder?: string;
  branchesTruncated?: string;
  branchRemote?: string;
  branchElsewhere?: string;
  /** Branch-bound pull request section. */
  pr?: string;
  prEmpty?: string;
  prWatch?: string;
  prUnwatch?: string;
  prWatchTip?: string;
  prUnwatchTip?: string;
  prOpenHub?: string;
  /** Aria/tip on the branch chip while a watch is mounted. */
  prChipTip?: string;
  /** Follow-ups waiting for an idle session. */
  prPendingWakes?: string;
  /** Short "watching" tag in the PR section head. */
  prWatchingLabel?: string;
  /** `Last update: {summary}` prefix for the change line. */
  prLastUpdate?: string;
  /** Shown when the host reported a poll failure for this watch. */
  prUnavailable?: string;
};

type Props = {
  /** Absolute path of the bound project (current worktree root). */
  activePath: string | null;
  worktrees: GitWorktreeEntry[];
  /**
   * `true` only after host confirmed a git work tree.
   * When not true the whole chip is hidden by the parent.
   */
  worktreesAvailable?: boolean | null;
  worktreesLoading?: boolean;
  worktreesReason?: string | null;
  /** Local + remote-only branches for in-place `git switch`. */
  branches?: GitBranchEntry[];
  branchesAvailable?: boolean | null;
  branchesLoading?: boolean;
  branchesReason?: string | null;
  branchesBusy?: boolean;
  /** CLI-tracked worktrees from `grok worktree list` (soft-fail). */
  cliWorktrees?: CliWorktreeEntry[];
  cliWorktreesLoading?: boolean;
  cliWorktreesAvailable?: boolean | null;
  cliWorktreesReason?: string | null;
  disabled?: boolean;
  /**
   * `chip` — generic toolbar.
   * `context` — new-session bar (flat trigger).
   */
  variant?: "chip" | "context";
  labels: ComposerWorktreeMenuLabels;
  onSwitch: (wt: GitWorktreeEntry) => void;
  /** In-place checkout, or bind the worktree that already holds this branch. */
  onSwitchBranch?: (branch: GitBranchEntry) => void;
  onCreate: () => void;
  onCreateAndChat: () => void;
  onGc: () => void;
  /** Push current branch + open GitHub PR (in-app Ship dialog). */
  onShip?: () => void;
  /**
   * Compare active linked worktree against main (file list + stats).
   * Parent opens GlassModal; no merge/apply.
   */
  onCompare?: () => void;
  /** Remove a live linked worktree (never main). Parent confirms + calls host. */
  onRemove?: (wt: GitWorktreeEntry) => void;
  onOpen?: () => void;
  /** Refresh CLI-tracked list (does not close menu). */
  onCliRefresh?: () => void;
  /** Reveal CLI worktree path in file manager. */
  onCliReveal?: (wt: CliWorktreeEntry) => void;
  /**
   * Open CLI worktree as session cwd when safe (path exists).
   * Parent reuses project-bind path like git worktree switch.
   */
  onCliOpen?: (wt: CliWorktreeEntry) => void;
  /**
   * Pull request bound to the current branch (git-native: head branch match).
   * `null` when the branch has no open PR — the chip then shows the branch only.
   */
  pr?: PrChipEntry | null;
  /** A host watch is mounted for this branch. */
  prWatching?: boolean;
  /** A watch/unwatch call is in flight. */
  prBusy?: boolean;
  /** Localized one-line summaries of the changes that woke the session. */
  prUpdates?: string[] | null;
  /** Wakes waiting for the session to go idle. */
  prPendingWakes?: number;
  /** Last host poll failure for this watch (shown as a soft error hint). */
  prWatchError?: string | null;
  onTogglePrWatch?: () => void;
  onOpenPrHub?: (prNumber: number) => void;
};

/** Minimal PR shape the branch chip needs to render. */
export type PrChipEntry = {
  number: number;
  title: string;
  state?: string | null;
  /** Localized checks rollup ("" when unknown). */
  checksLine?: string | null;
};

const LIST_MAX_H = 200;
const BRANCH_LIST_MAX_H = 200;
const CLI_LIST_MAX_H = 160;

export function ComposerWorktreeMenu({
  activePath,
  worktrees = [],
  worktreesLoading = false,
  worktreesReason = null,
  branches = [],
  branchesAvailable = null,
  branchesLoading = false,
  branchesReason = null,
  branchesBusy = false,
  cliWorktrees = [],
  cliWorktreesLoading = false,
  cliWorktreesAvailable = null,
  cliWorktreesReason = null,
  disabled,
  variant = "context",
  labels,
  onSwitch,
  onSwitchBranch,
  onCreate,
  onCreateAndChat,
  onGc,
  onShip,
  onCompare,
  onRemove,
  onOpen,
  onCliRefresh,
  onCliReveal,
  onCliOpen,
  pr = null,
  prWatching = false,
  prBusy = false,
  prUpdates = null,
  prPendingWakes = 0,
  prWatchError = null,
  onTogglePrWatch,
  onOpenPrHub,
}: Props) {
  const [open, setOpen] = useState(false);
  const [branchQuery, setBranchQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;

  const current =
    worktrees.find((wt) => pathsEqual(wt.path, activePath)) ?? null;
  const branchLabel = current
    ? worktreeLabel(current)
    : worktreesLoading
      ? labels.worktreesLoading || "…"
      : "—";

  const showCliSection =
    !!labels.cliWorktrees &&
    (cliWorktreesAvailable !== null ||
      cliWorktreesLoading ||
      cliWorktrees.length > 0 ||
      !!onCliRefresh);
  const showBranchesSection = !!onSwitchBranch && !!labels.branches;
  const showPrSection = !!pr || prWatching;
  // Reserve the PR section's height so first paint matches the final layout.
  const prSectionHeight = showPrSection
    ? 28 + 36 + (onTogglePrWatch && pr ? 36 : 0)
    : 0;
  const filteredBranches = showBranchesSection
    ? capGitBranchesForMenu(
        filterGitBranches(sortGitBranches(branches), branchQuery),
      )
    : { rows: [] as GitBranchEntry[], truncated: false, total: 0 };
  const showBranchLoading = branchesLoading && branches.length === 0;

  // Fixed size estimate so first paint matches final layout (avoids open flash).
  const listCount = Math.max(worktrees.length, 1);
  const branchCount = showBranchesSection
    ? Math.max(filteredBranches.rows.length, 1)
    : 0;
  const cliCount = showCliSection
    ? Math.max(cliWorktrees.length, 1)
    : 0;
  const showShip = !!onShip && !!(labels.worktreeShip || labels.worktreeShipTip);
  // Compare only when not on main (linked worktree / sibling).
  const showCompare =
    !!onCompare &&
    !!(labels.worktreeCompare || labels.worktreeCompareTip) &&
    !!current &&
    !current.isMain;
  const actionCount = 3 + (showShip ? 1 : 0) + (showCompare ? 1 : 0);
  const estHeight = Math.min(
    620,
    44 +
      prSectionHeight +
      (showBranchesSection
        ? 28 + 40 + Math.min(BRANCH_LIST_MAX_H, branchCount * 36 + 8)
        : 0) +
      Math.min(LIST_MAX_H, listCount * 36 + 8) +
      actionCount * 36 +
      16 +
      (showCliSection
        ? 28 + Math.min(CLI_LIST_MAX_H, cliCount * 36 + 8) + 28
        : 0),
  );
  // Soft-refresh loading should not re-anchor / dim when we already have rows.
  const showLoading = worktreesLoading && worktrees.length === 0;
  const showCliLoading = cliWorktreesLoading && cliWorktrees.length === 0;
  const removeLabel =
    labels.worktreeRemoveTip ||
    labels.worktreeRemove ||
    "Remove worktree";
  const cliHead = labels.cliWorktrees || "CLI worktrees";
  const cliRefreshLabel = labels.cliWorktreeRefresh || "Refresh";
  const cliRevealLabel = labels.cliWorktreeReveal || "Reveal";
  const cliOpenLabel = labels.cliWorktreeOpen || "Open as project";
  const cliOpenBlocked =
    labels.cliWorktreeOpenUnavailable || "Path missing — cannot open";

  const { pos, style: popStyle } = useFloatingMenu({
    open,
    triggerRef,
    panelRef: popRef,
    roots: [rootRef],
    onClose: () => setOpen(false),
    // Welcome composer is vertically centered — auto picks up/down so the menu fits.
    placement: "auto",
    // Fixed width: fitContent + label measure caused first-open width "squeeze" flash.
    fitContent: false,
    width: 288,
    minWidth: 288,
    estHeight,
    gap: 8,
    // Only re-anchor when row count changes, not on soft-refresh loading toggles.
    deps: [
      worktrees.length,
      cliWorktrees.length,
      showCliSection,
      showPrSection,
      filteredBranches.rows.length,
      showBranchesSection,
    ],
  });

  useEffect(() => {
    if (!open) return;
    onOpenRef.current?.();
  }, [open]);

  useEffect(() => {
    if (!open) setBranchQuery("");
  }, [open]);

  const isContext = variant === "context";
  const tip = current?.path
    ? `${labels.worktreeTip}\n${current.path}`
    : labels.worktreeTip;
  // A PR shows on the chip only while it is actually being watched, so the
  // branch area never advertises a follow-up that is not happening.
  const showChipPr = isContext && prWatching && !!pr;
  const prChipTitle = pr ? truncatePrTitle(pr.title, PR_CHIP_TITLE_MAX) : "";
  const prAria =
    showChipPr && pr && labels.prChipTip
      ? `${labels.worktreeTip} · ${labels.prChipTip
          .replace("{number}", String(pr.number))
          .replace("{title}", pr.title)}`
      : labels.worktreeTip;
  const prMeta = pr
    ? [String(pr.state ?? "").trim(), String(pr.checksLine ?? "").trim()]
        .filter(Boolean)
        .join(" · ")
    : "";
  const pendingLabel =
    prPendingWakes > 0 && labels.prPendingWakes
      ? labels.prPendingWakes.replace("{count}", String(prPendingWakes))
      : "";

  return (
    <div
      ref={rootRef}
      className={
        `cwm${open ? " is-open" : ""}` + (isContext ? " cwm--context" : "")
      }
    >
      <Tip label={tip} disabled={open}>
        <button
          ref={triggerRef}
          type="button"
          className={
            isContext
              ? "composer__context-item composer__context-item--branch" +
                (open ? " is-open" : "") +
                (showLoading ? " is-loading" : "") +
                (showChipPr ? " has-pr" : "")
              : "chip chip--branch" +
                (open ? " is-open" : "") +
                (showLoading ? " is-loading" : "")
          }
          disabled={disabled}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={prAria}
          onClick={() => setOpen((v) => !v)}
        >
          <IconGitBranch size={14} aria-hidden />
          <span
            className={isContext ? "composer__context-label" : "chip__label"}
          >
            {branchLabel}
          </span>
          {showChipPr && pr ? (
            <span className="composer__context-pr">
              <span className="composer__context-pr-num">#{pr.number}</span>
              {prChipTitle ? (
                <span className="composer__context-pr-title">{prChipTitle}</span>
              ) : null}
            </span>
          ) : null}
        </button>
      </Tip>
      {open &&
        pos &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={popRef}
            className="cmm__pop cmm__pop--portal cwm__pop"
            role="menu"
            aria-label={labels.worktrees}
            style={popStyle as CSSProperties}
          >
            {showPrSection ? (
              <div className="cwm__pr">
                <div className="cwm__head cwm__pr-head">
                  <span>{labels.pr || "Pull request"}</span>
                  {prWatching && labels.prWatchingLabel ? (
                    <span className="cwm__pr-tag">
                      {labels.prWatchingLabel}
                    </span>
                  ) : null}
                </div>
                {pr ? (
                  <button
                    type="button"
                    role="menuitem"
                    className="cmm__opt cwm__item cwm__pr-row"
                    title={labels.prOpenHub ? `${pr.title}\n${labels.prOpenHub}` : pr.title}
                    onClick={() => {
                      setOpen(false);
                      onOpenPrHub?.(pr.number);
                    }}
                  >
                    <span className="cwm__item-main">
                      <span className="cwm__item-name">
                        {formatPrChipLabel(pr, PR_MENU_TITLE_MAX)}
                      </span>
                      {prMeta ? (
                        <span className="cwm__item-meta">{prMeta}</span>
                      ) : null}
                    </span>
                  </button>
                ) : (
                  <p className="cwm__empty">
                    {labels.prEmpty || "No pull request for this branch"}
                  </p>
                )}
                {onTogglePrWatch && pr ? (
                  <Tip label={prWatching ? labels.prUnwatchTip : labels.prWatchTip}>
                    <button
                      type="button"
                      role="menuitem"
                      className="cwm__action"
                      aria-pressed={prWatching}
                      disabled={disabled || prBusy}
                      onClick={() => {
                        setOpen(false);
                        onTogglePrWatch();
                      }}
                    >
                      {prWatching ? (
                        <IconBellOff size={14} aria-hidden />
                      ) : (
                        <IconBell size={14} aria-hidden />
                      )}
                      <span>
                        {prWatching
                          ? labels.prUnwatch || "Stop watching"
                          : labels.prWatch || "Watch this PR"}
                      </span>
                    </button>
                  </Tip>
                ) : null}
                {prWatching && prUpdates && prUpdates.length > 0 ? (
                  <p className="cwm__empty cwm__empty--hint">
                    {labels.prLastUpdate
                      ? labels.prLastUpdate.replace("{summary}", prUpdates[0])
                      : prUpdates[0]}
                  </p>
                ) : null}
                {prWatching && prWatchError && labels.prUnavailable ? (
                  <p className="cwm__empty cwm__empty--hint">
                    {labels.prUnavailable}
                  </p>
                ) : null}
                {pendingLabel ? (
                  <p className="cwm__empty cwm__empty--hint">{pendingLabel}</p>
                ) : null}
              </div>
            ) : null}
            {showBranchesSection ? (
              <div className="cwm__branches">
                <div className="cwm__head">{labels.branches}</div>
                <div className="cmm__search">
                  <input
                    type="search"
                    className="cmm__search-input"
                    value={branchQuery}
                    onChange={(e) => setBranchQuery(e.target.value)}
                    placeholder={
                      labels.branchesSearchPlaceholder || "Filter branches…"
                    }
                    aria-label={
                      labels.branchesSearchPlaceholder || "Filter branches…"
                    }
                    autoComplete="off"
                    spellCheck={false}
                    disabled={disabled || branchesBusy}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.preventDefault();
                      e.stopPropagation();
                    }}
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>
                {filteredBranches.rows.length > 0 ? (
                  <ul
                    className={
                      "cwm__list cwm__list--branches" +
                      (showBranchLoading || branchesBusy ? " is-loading" : "")
                    }
                    aria-busy={
                      showBranchLoading || branchesBusy || undefined
                    }
                    style={{ maxHeight: BRANCH_LIST_MAX_H }}
                  >
                    {filteredBranches.rows.map((row) => {
                      const elsewhere = branchCheckedOutElsewhere(
                        row,
                        activePath,
                      );
                      const meta = [
                        row.current ? labels.worktreeCurrent : null,
                        row.remote
                          ? labels.branchRemote || "remote"
                          : null,
                        elsewhere
                          ? labels.branchElsewhere || "other worktree"
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ");
                      const rowDisabled =
                        disabled ||
                        branchesBusy ||
                        row.current ||
                        (elsewhere && !onSwitch);
                      return (
                        <li
                          key={`${row.remote ? "r" : "l"}:${row.name}`}
                          className="cwm__row"
                        >
                          <div className="cwm__row-inner">
                            <button
                              type="button"
                              role="menuitem"
                              className={
                                "cmm__opt cwm__item" +
                                (row.current ? " is-active" : "") +
                                (elsewhere ? " is-muted" : "")
                              }
                              title={
                                row.upstream
                                  ? `${row.name}\n${row.upstream}`
                                  : row.name
                              }
                              disabled={rowDisabled}
                              onClick={() => {
                                if (rowDisabled) return;
                                setOpen(false);
                                onSwitchBranch?.(row);
                              }}
                            >
                              <span className="cwm__item-main">
                                <span className="cwm__item-name">
                                  {row.name}
                                </span>
                                {meta ? (
                                  <span className="cwm__item-meta">
                                    {meta}
                                  </span>
                                ) : null}
                              </span>
                              {row.current ? (
                                <span
                                  className="cmm__opt-check"
                                  aria-hidden
                                >
                                  <IconCheck size={16} />
                                </span>
                              ) : null}
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="cwm__empty">
                    {showBranchLoading
                      ? labels.branchesLoading ||
                        labels.worktreesLoading ||
                        "…"
                      : branchesAvailable === false ||
                          !!branchesReason?.trim()
                        ? labels.branchesUnavailable ||
                          labels.worktreesUnavailable
                        : labels.branchesEmpty || labels.worktreesEmpty}
                  </p>
                )}
                {filteredBranches.truncated && labels.branchesTruncated ? (
                  <p className="cwm__empty cwm__empty--hint">
                    {labels.branchesTruncated
                      .replace("{shown}", String(filteredBranches.rows.length))
                      .replace("{total}", String(filteredBranches.total))}
                  </p>
                ) : null}
              </div>
            ) : null}
            <div className="cwm__head">{labels.worktrees}</div>
            {worktrees.length > 0 ? (
              <ul
                className={"cwm__list" + (showLoading ? " is-loading" : "")}
                aria-busy={showLoading || undefined}
                style={{ maxHeight: LIST_MAX_H }}
              >
                {worktrees.map((wt) => {
                  const isCurrent = pathsEqual(wt.path, activePath);
                  const name = worktreeLabel(wt);
                  const meta = [
                    wt.isMain ? labels.worktreeMain : null,
                    wt.detached ? labels.worktreeDetached : null,
                    isCurrent ? labels.worktreeCurrent : null,
                  ]
                    .filter(Boolean)
                    .join(" · ");
                  const showRemove =
                    !!onRemove && canRemoveWorktree(wt);
                  return (
                    <li key={wt.path} className="cwm__row">
                      <div className="cwm__row-inner">
                        <button
                          type="button"
                          role="menuitem"
                          className={
                            "cmm__opt cwm__item" +
                            (isCurrent ? " is-active" : "")
                          }
                          title={wt.path}
                          disabled={isCurrent}
                          onClick={() => {
                            if (isCurrent) return;
                            setOpen(false);
                            onSwitch(wt);
                          }}
                        >
                          <span className="cwm__item-main">
                            <span className="cwm__item-name">{name}</span>
                            {meta ? (
                              <span className="cwm__item-meta">{meta}</span>
                            ) : null}
                          </span>
                          {isCurrent ? (
                            <span className="cmm__opt-check" aria-hidden>
                              <IconCheck size={16} />
                            </span>
                          ) : null}
                        </button>
                        {showRemove ? (
                          <Tip label={removeLabel}>
                            <button
                              type="button"
                              className="cwm__row-remove"
                              aria-label={
                                labels.worktreeRemove || removeLabel
                              }
                              title={removeLabel}
                              disabled={
                                disabled || worktreesLoading || showLoading
                              }
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setOpen(false);
                                onRemove?.(wt);
                              }}
                            >
                              <IconTrash size={14} aria-hidden />
                            </button>
                          </Tip>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="cwm__empty">
                {worktreesReason?.trim()
                  ? labels.worktreesUnavailable
                  : labels.worktreesEmpty}
              </p>
            )}

            <div className="cwm__actions">
              <button
                type="button"
                role="menuitem"
                className="cwm__action"
                onClick={() => {
                  setOpen(false);
                  onCreate();
                }}
              >
                <IconPlus size={14} aria-hidden />
                <span>{labels.worktreeNew}</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className="cwm__action"
                onClick={() => {
                  setOpen(false);
                  onCreateAndChat();
                }}
              >
                <IconPlus size={14} aria-hidden />
                <span>{labels.worktreeNewChat}</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className="cwm__action cwm__action--muted"
                onClick={() => {
                  setOpen(false);
                  onGc();
                }}
              >
                <IconTrash size={14} aria-hidden />
                <span>{labels.worktreeGc}</span>
              </button>
              {showCompare ? (
                <button
                  type="button"
                  role="menuitem"
                  className="cwm__action"
                  title={
                    labels.worktreeCompareTip || labels.worktreeCompare
                  }
                  onClick={() => {
                    setOpen(false);
                    onCompare?.();
                  }}
                >
                  <IconFileDiff size={14} aria-hidden />
                  <span>{labels.worktreeCompare || "Compare with main…"}</span>
                </button>
              ) : null}
              {showShip ? (
                <button
                  type="button"
                  role="menuitem"
                  className="cwm__action"
                  title={labels.worktreeShipTip || labels.worktreeShip}
                  onClick={() => {
                    setOpen(false);
                    onShip?.();
                  }}
                >
                  <IconUpload size={14} aria-hidden />
                  <span>{labels.worktreeShip || "Ship…"}</span>
                </button>
              ) : null}
            </div>

            {showCliSection ? (
              <div className="cwm__cli">
                <div className="cwm__cli-head">
                  <span className="cwm__head cwm__head--inline">{cliHead}</span>
                  {onCliRefresh ? (
                    <Tip label={cliRefreshLabel}>
                      <button
                        type="button"
                        className="cwm__cli-refresh"
                        aria-label={cliRefreshLabel}
                        disabled={disabled || cliWorktreesLoading}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          onCliRefresh();
                        }}
                      >
                        <IconRefresh
                          size={14}
                          aria-hidden
                          className={
                            cliWorktreesLoading ? "is-spin" : undefined
                          }
                        />
                      </button>
                    </Tip>
                  ) : null}
                </div>
                {cliWorktreesAvailable === false &&
                cliWorktrees.length === 0 ? (
                  <p className="cwm__empty">
                    {cliWorktreesReason?.trim()
                      ? labels.cliWorktreesUnavailable ||
                        labels.worktreesUnavailable
                      : labels.cliWorktreesEmpty || labels.worktreesEmpty}
                  </p>
                ) : cliWorktrees.length > 0 ? (
                  <ul
                    className={
                      "cwm__list cwm__list--cli" +
                      (showCliLoading ? " is-loading" : "")
                    }
                    aria-busy={showCliLoading || undefined}
                    style={{ maxHeight: CLI_LIST_MAX_H }}
                  >
                    {cliWorktrees.map((wt) => {
                      const isCurrent = pathsEqual(wt.path, activePath);
                      const canOpen =
                        !!onCliOpen &&
                        canOpenCliWorktreeAsCwd(wt) &&
                        !isCurrent;
                      const meta = cliWorktreeMetaLabel(wt, {
                        current: isCurrent
                          ? labels.worktreeCurrent
                          : undefined,
                      });
                      const tipLine = [
                        canOpen ? cliOpenLabel : !isCurrent ? cliOpenBlocked : null,
                        wt.path,
                        wt.status ? `status: ${wt.status}` : null,
                        !wt.pathOk
                          ? labels.cliWorktreeMissingPath || null
                          : null,
                      ]
                        .filter(Boolean)
                        .join("\n");
                      return (
                        <li key={wt.id || wt.path} className="cwm__row">
                          <div className="cwm__row-inner">
                            <button
                              type="button"
                              role="menuitem"
                              className={
                                "cmm__opt cwm__item" +
                                (isCurrent ? " is-active" : "") +
                                (!canOpen && !isCurrent
                                  ? " is-muted"
                                  : "")
                              }
                              title={tipLine}
                              disabled={
                                disabled ||
                                isCurrent ||
                                !canOpen
                              }
                              onClick={() => {
                                if (!canOpen) return;
                                setOpen(false);
                                onCliOpen?.(wt);
                              }}
                            >
                              <span className="cwm__item-main">
                                <span className="cwm__item-name">
                                  {wt.name}
                                </span>
                                {meta ? (
                                  <span className="cwm__item-meta">
                                    {meta}
                                  </span>
                                ) : null}
                              </span>
                              {isCurrent ? (
                                <span className="cmm__opt-check" aria-hidden>
                                  <IconCheck size={16} />
                                </span>
                              ) : null}
                            </button>
                            {onCliReveal && wt.path ? (
                              <Tip label={cliRevealLabel}>
                                <button
                                  type="button"
                                  className="cwm__row-remove cwm__row-reveal"
                                  aria-label={cliRevealLabel}
                                  title={cliRevealLabel}
                                  disabled={
                                    disabled ||
                                    !wt.pathOk
                                  }
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    onCliReveal(wt);
                                  }}
                                >
                                  <IconFolder size={14} aria-hidden />
                                </button>
                              </Tip>
                            ) : null}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="cwm__empty">
                    {showCliLoading
                      ? labels.cliWorktreesLoading ||
                        labels.worktreesLoading ||
                        "…"
                      : labels.cliWorktreesEmpty || labels.worktreesEmpty}
                  </p>
                )}
              </div>
            ) : null}
          </div>,
          document.body,
        )}
    </div>
  );
}
