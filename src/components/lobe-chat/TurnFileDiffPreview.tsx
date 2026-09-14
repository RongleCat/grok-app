/**
 * Mini unified-diff preview for turn changed-file cards (#998 P1).
 * Reuses Review `sw-review-line*` classes; truncates long patches.
 */

import { memo, useMemo } from "react";
import { CopyIconButton } from "@/components/CopyIconButton";
import type { Locale } from "@/i18n";
import { createT } from "@/i18n";
import { parseReviewPatch, type ReviewDiffRow } from "@/lib/reviewDiff";

/** Max rendered diff lines (ctx/add/del) before truncate + open Review. */
export const TURN_FILE_DIFF_LINE_CAP = 40;

function lineClass(kind: string): string {
  if (kind === "add") return "sw-review-line sw-review-line--add";
  if (kind === "del") return "sw-review-line sw-review-line--del";
  return "sw-review-line sw-review-line--ctx";
}

function visibleRows(
  rows: ReviewDiffRow[],
  cap: number,
): { shown: ReviewDiffRow[]; totalLines: number; truncated: boolean } {
  const lineRows = rows.filter((r) => r.type === "line");
  const totalLines = lineRows.length;
  if (totalLines <= cap) {
    return { shown: rows, totalLines, truncated: false };
  }
  const out: ReviewDiffRow[] = [];
  let counted = 0;
  for (const row of rows) {
    if (row.type === "fold") {
      if (counted < cap) out.push(row);
      continue;
    }
    if (counted >= cap) break;
    out.push(row);
    counted++;
  }
  return { shown: out, totalLines, truncated: true };
}

export const TurnFileDiffPreview = memo(function TurnFileDiffPreview({
  patch,
  locale,
  onOpenInReview,
}: {
  patch: string | null;
  locale: Locale;
  onOpenInReview?: () => void;
}) {
  const tr = useMemo(() => createT(locale), [locale]);
  const parsed = useMemo(() => parseReviewPatch(patch), [patch]);
  const { shown, totalLines, truncated } = useMemo(
    () => visibleRows(parsed.rows, TURN_FILE_DIFF_LINE_CAP),
    [parsed.rows],
  );

  if (!patch || parsed.empty) {
    return (
      <div
        className="lobe-turn-changed__preview"
        role="region"
        aria-label={tr("chat.changedFiles.aria")}
      >
        <p className="lobe-turn-changed__empty">{tr("chat.changedFiles.noDiffYet")}</p>
        {onOpenInReview ? (
          <button
            type="button"
            className="lobe-turn-changed__open-review"
            data-testid="turn-file-open-review"
            onClick={onOpenInReview}
          >
            {tr("chat.changedFiles.openInReview")}
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className="lobe-turn-changed__preview"
      role="region"
      aria-label={tr("chat.changedFiles.aria")}
    >
      <div className="lobe-turn-changed__preview-bar">
        <CopyIconButton
          text={patch}
          copyLabel={tr("chat.changedFiles.copyDiff")}
          copiedLabel={tr("message.copied")}
          testId="turn-file-copy-diff"
        />
      </div>
      <div className="lobe-turn-changed__diff" data-testid="turn-file-diff">
        {shown.map((row, i) => {
          if (row.type === "fold") {
            return (
              <div
                key={row.id}
                className="sw-review-fold"
                role="presentation"
              >
                <span className="sw-review-fold__chev" aria-hidden>
                  ▴
                </span>
                <span>
                  {tr("side.review.unmodified", { n: String(row.count) })}
                </span>
                <span className="sw-review-fold__chev" aria-hidden>
                  ▾
                </span>
              </div>
            );
          }
          return (
            <div
              key={`L${i}-${row.ln ?? ""}-${row.kind}`}
              className={lineClass(row.kind)}
            >
              <span className="sw-review-line__ln" aria-hidden>
                {row.ln ?? ""}
              </span>
              <span className="sw-review-line__code">{row.text}</span>
            </div>
          );
        })}
      </div>
      {truncated ? (
        <p className="lobe-turn-changed__truncated">
          {tr("chat.changedFiles.truncated", {
            shown: String(TURN_FILE_DIFF_LINE_CAP),
            total: String(totalLines),
          })}
        </p>
      ) : null}
      {onOpenInReview ? (
        <button
          type="button"
          className="lobe-turn-changed__open-review"
          data-testid="turn-file-open-review"
          onClick={onOpenInReview}
        >
          {tr("chat.changedFiles.openInReview")}
        </button>
      ) : null}
    </div>
  );
});
