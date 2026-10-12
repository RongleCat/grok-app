/**
 * Branch menu's **Pull request** section: every open PR of this repository, one
 * compact row each with its watch control inline.
 *
 * A pull request is opened against a repository, so the menu lists the repo's
 * PRs instead of guessing which one belongs to the checked-out branch; the head
 * branch a row names is the PR's own property, not a binding. Each row carries
 * its own bell — the same trailing control the worktree rows use — so a chat can
 * follow several PRs without the section growing a button per PR, and toggling
 * one leaves the menu open for the next.
 */

import { useEffect, useRef } from "react";
import { IconBell, IconBellOff } from "@/components/icons";
import { Tip } from "@/components/ui/tooltip";
import { PR_ROW_TITLE_MAX, formatPrRowLabel, type PrListRow } from "@/lib/prMonitor";

/** Height the PR row list may grow to before it scrolls. */
export const PR_LIST_MAX_H = 160;

/** Localized copy the section reads (a slice of the branch menu's catalog). */
export type ComposerPrSectionLabels = {
  pr?: string;
  prEmpty?: string;
  prWatch?: string;
  prUnwatch?: string;
  prWatchTip?: string;
  prUnwatchTip?: string;
  prOpenHub?: string;
  /** Short "watching" tag in the section head. */
  prWatchingLabel?: string;
  /** `Last update: {summary}` prefix for the change line. */
  prLastUpdate?: string;
  /** Follow-ups waiting for an idle chat. */
  prPendingWakes?: string;
  /** Shown when the host reported a poll failure. */
  prUnavailable?: string;
};

type Props = {
  /** One row per open PR of this repository. */
  rows?: PrListRow[];
  /** A repo PR read is in flight. */
  loading?: boolean;
  /** Localized summary of the most recent delivered change. */
  lastChange?: string | null;
  /** Wakes waiting for this chat to go idle. */
  pendingWakes?: number;
  /** Last host poll failure, or `null` when healthy. */
  watchError?: string | null;
  disabled?: boolean;
  labels: ComposerPrSectionLabels;
  /** Row click: the parent closes the menu and opens the PR hub. */
  onOpenPrHub?: (prNumber: number) => void;
  onToggleWatch?: (prNumber: number) => void;
  /** The list is on screen (each open reads the repo's PRs once). */
  onVisible?: () => void;
};

/**
 * What the section will show, so the menu can reserve its height up front.
 *
 * `visible` false renders nothing: with no `gh`, no repository, or no project
 * there is no PR list to offer, and the menu keeps the branch area as it is.
 * A repository whose list is readable is shown even when it holds no open PR —
 * that is an answer, not a silence.
 */
export function composerPrSection(input: {
  rows: number;
  loading?: boolean;
  available?: boolean | null;
}): { visible: boolean; rows: number } {
  const rows = Math.max(0, Math.trunc(Number(input.rows) || 0));
  return { visible: rows > 0 || !!input.loading || input.available === true, rows };
}

export function ComposerPrListSection({
  rows = [],
  loading = false,
  lastChange = null,
  pendingWakes = 0,
  watchError = null,
  disabled,
  labels,
  onOpenPrHub,
  onToggleWatch,
  onVisible,
}: Props) {
  const onVisibleRef = useRef(onVisible);
  onVisibleRef.current = onVisible;
  useEffect(() => {
    onVisibleRef.current?.();
  }, []);

  const pendingLabel =
    pendingWakes > 0 && labels.prPendingWakes
      ? labels.prPendingWakes.replace("{count}", String(pendingWakes))
      : "";
  const watchingCount = rows.filter((row) => row.watching).length;

  return (
    <div className="cwm__pr">
      <div className="cwm__head cwm__pr-head">
        <span>{labels.pr || "Pull request"}</span>
        {watchingCount > 0 && labels.prWatchingLabel ? (
          <span className="cwm__pr-tag">{labels.prWatchingLabel}</span>
        ) : null}
      </div>
      {rows.length > 0 ? (
        <ul className="cwm__list cwm__list--pr" style={{ maxHeight: PR_LIST_MAX_H }}>
          {rows.map((row) => {
            const meta = [
              String(row.state ?? "").trim(),
              String(row.checksLine ?? "").trim(),
              String(row.branch ?? "").trim(),
            ]
              .filter(Boolean)
              .join(" · ");
            const title = [row.title, row.branch, labels.prOpenHub]
              .filter(Boolean)
              .join("\n");
            return (
              <li className="cwm__row" key={row.number}>
                <div className="cwm__row-inner">
                  <button
                    type="button"
                    role="menuitem"
                    className="cmm__opt cwm__item cwm__pr-row"
                    title={title}
                    onClick={() => onOpenPrHub?.(row.number)}
                  >
                    <span className="cwm__item-main">
                      <span className="cwm__item-name">
                        {formatPrRowLabel(row, PR_ROW_TITLE_MAX)}
                      </span>
                      {meta ? (
                        <span className="cwm__item-meta">{meta}</span>
                      ) : null}
                    </span>
                  </button>
                  {onToggleWatch ? (
                    <Tip
                      label={row.watching ? labels.prUnwatchTip : labels.prWatchTip}
                      /* The tip explains what watching does, so it must not be
                         cut: several locales need a second line for that. */
                      className="ui-tip--wrap"
                    >
                      <button
                        type="button"
                        className={
                          "cwm__row-toggle" + (row.watching ? " is-on" : "")
                        }
                        aria-pressed={row.watching}
                        aria-label={
                          row.watching
                            ? labels.prUnwatch || "Stop watching"
                            : labels.prWatch || "Watch this PR"
                        }
                        disabled={disabled || row.busy}
                        onClick={() => onToggleWatch(row.number)}
                      >
                        {row.watching ? (
                          <IconBellOff size={14} aria-hidden />
                        ) : (
                          <IconBell size={14} aria-hidden />
                        )}
                      </button>
                    </Tip>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="cwm__empty">{loading ? "…" : labels.prEmpty || "No open pull requests"}</p>
      )}
      {lastChange && labels.prLastUpdate ? (
        <p className="cwm__empty cwm__empty--hint">
          {labels.prLastUpdate.replace("{summary}", lastChange)}
        </p>
      ) : null}
      {watchError && labels.prUnavailable ? (
        <p className="cwm__empty cwm__empty--hint">{labels.prUnavailable}</p>
      ) : null}
      {pendingLabel ? (
        <p className="cwm__empty cwm__empty--hint">{pendingLabel}</p>
      ) : null}
    </div>
  );
}
