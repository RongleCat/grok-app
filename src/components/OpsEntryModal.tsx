/**
 * Ops hub — one entry that routes to Tasks / Dashboard / Task board / Batch.
 * Pure catalog + honesty meta from `opsEntry`; no invented fleet metrics.
 */

import { useMemo } from "react";
import type { Locale, MessageKey } from "@/i18n";
import { createT } from "@/i18n";
import { GlassModal } from "@/components/GlassModal";
import {
  IconActivity,
  IconList,
  IconScheduled,
} from "@/components/icons";
import {
  buildOpsEntryRows,
  resolveOpsEntryEmptyBanner,
  type OpsEntryCounts,
  type OpsEntryDestinationId,
  type OpsEntryRow,
} from "@/lib/opsEntry";

type TFn = (key: MessageKey, vars?: Record<string, string | number>) => string;

function destIcon(id: OpsEntryDestinationId) {
  const size = 16;
  switch (id) {
    case "dashboard":
      return <IconActivity size={size} />;
    case "batch_agents":
      return <IconScheduled size={size} />;
    case "tasks":
    case "task_board":
    default:
      return <IconList size={size} />;
  }
}

function OpsEntryRowButton({
  row,
  t,
  onSelect,
}: {
  row: OpsEntryRow;
  t: TFn;
  onSelect: (id: OpsEntryDestinationId) => void;
}) {
  const metaText = t(
    row.meta.labelKey as MessageKey,
    row.meta.vars as Record<string, string | number> | undefined,
  );
  return (
    <button
      type="button"
      className={
        "ops-entry__row" + (row.meta.empty ? " ops-entry__row--empty" : "")
      }
      onClick={() => onSelect(row.id)}
      data-ops-dest={row.id}
      data-ops-empty={row.meta.empty ? "1" : "0"}
    >
      <span className="ops-entry__icon" aria-hidden>
        {destIcon(row.id)}
      </span>
      <span className="ops-entry__body">
        <span className="ops-entry__title">{t(row.labelKey as MessageKey)}</span>
        <span className="ops-entry__hint">{t(row.hintKey as MessageKey)}</span>
      </span>
      <span className="ops-entry__meta" data-kind={row.meta.kind}>
        {metaText}
      </span>
    </button>
  );
}

export type OpsEntryModalProps = {
  open: boolean;
  locale: Locale;
  counts: OpsEntryCounts;
  onClose: () => void;
  /** Navigate to a destination (parent opens existing modals / panel). */
  onSelect: (id: OpsEntryDestinationId) => void;
};

export function OpsEntryModal({
  open,
  locale,
  counts,
  onClose,
  onSelect,
}: OpsEntryModalProps) {
  const tr = useMemo(() => createT(locale), [locale]);
  const rows = useMemo(() => buildOpsEntryRows(counts), [counts]);
  const emptyBanner = useMemo(
    () => resolveOpsEntryEmptyBanner(counts),
    [counts],
  );

  return (
    <GlassModal
      open={open}
      onClose={onClose}
      title={tr("ops.title")}
      titleId="ops-entry-title"
      closeLabel={tr("common.close")}
      size="sm"
      className="ops-entry-modal"
      wrapBody
      bodyClassName="ops-entry-modal__body"
      footer={
        <button type="button" className="btn btn--solid" onClick={onClose}>
          {tr("common.close")}
        </button>
      }
    >
      <p className="ops-entry__lead">{tr("ops.hint")}</p>
      {emptyBanner ? (
        <div
          className="ops-entry__empty"
          role="status"
          data-kind={emptyBanner.kind}
        >
          <p className="ops-entry__empty-title">
            {tr(emptyBanner.titleKey as MessageKey)}
          </p>
          <p className="ops-entry__empty-hint">
            {tr(emptyBanner.hintKey as MessageKey)}
          </p>
        </div>
      ) : null}
      <div
        className="ops-entry__list"
        role="list"
        aria-label={tr("ops.destinations")}
      >
        {rows.map((row) => (
          <div key={row.id} role="listitem">
            <OpsEntryRowButton row={row} t={tr} onSelect={onSelect} />
          </div>
        ))}
      </div>
    </GlassModal>
  );
}
