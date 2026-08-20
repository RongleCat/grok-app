import type { Ref } from "react";
import { createT, type Locale } from "@/i18n";
import { IconClose, IconHelp } from "@/components/icons";
import { Select } from "@/components/Select";
import { Tip } from "@/components/ui/tooltip";
import {
  COMPACTION_DETAILS,
  COMPACTION_MODES,
  compactionDetailApplies,
  normalizeCompactionDetail,
  normalizeCompactionMode,
  type CompactionDetailId,
  type CompactionModeId,
} from "@/lib/compactionMode";
import {
  COMPACT_PRESET_IDS,
  estimateCompactAfterTokens,
  formatCompactBeforeAfterRange,
  formatTokenCount,
  type CompactPresetId,
  type ContextUsageDisplay,
} from "@/lib/contextUsage";

export function CompactModal(props: {
  locale: Locale;
  formRef: Ref<HTMLFormElement>;
  noteInputRef: Ref<HTMLInputElement>;
  note: string;
  preset: CompactPresetId;
  compactionMode: CompactionModeId;
  compactionDetail: CompactionDetailId;
  turnLive: boolean;
  usage: ContextUsageDisplay;
  onClose: () => void;
  onNoteChange: (value: string) => void;
  onPresetChange: (id: CompactPresetId) => void;
  onCompactionModeChange: (id: CompactionModeId) => void;
  onCompactionDetailChange: (id: CompactionDetailId) => void;
  onSubmit: (note: string, preset: CompactPresetId) => void;
}) {
  const tr = createT(props.locale);
  return (
    <div
      className="overlay"
      role="presentation"
      onClick={props.onClose}
    >
      <form
        ref={props.formRef}
        className="modal compact-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="compact-modal-title"
        onSubmit={(e) => {
          e.preventDefault();
          if (props.turnLive) return;
          props.onSubmit(props.note, props.preset);
        }}
      >
        <header className="modal-head">
          <div className="compact-modal__title-row">
            <h2 id="compact-modal-title" className="modal-title">
              {tr("slash.compact")}
            </h2>
            <Tip
              label={tr("slash.compactHelpTip")}
              placement="bottom"
              delayMs={280}
              className="ui-tip--wrap ui-tip--modal"
            >
              <button
                type="button"
                className="settings-label-help"
                aria-label={tr("slash.compactHelp")}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
              >
                <IconHelp size={14} stroke={1.75} />
              </button>
            </Tip>
          </div>
          <button
            type="button"
            className="icon-btn modal-close"
            onClick={props.onClose}
            aria-label={tr("common.close")}
          >
            <IconClose size={16} />
          </button>
        </header>
        <div className="compact-modal__body">
          <div
            className="compact-modal__presets"
            role="radiogroup"
            aria-label={tr("slash.compactPresets")}
          >
            {COMPACT_PRESET_IDS.map((id) => {
              const labelKey =
                id === "light"
                  ? "slash.compactPreset.light"
                  : id === "aggressive"
                    ? "slash.compactPreset.aggressive"
                    : "slash.compactPreset.standard";
              const hintKey =
                id === "light"
                  ? "slash.compactPresetHint.light"
                  : id === "aggressive"
                    ? "slash.compactPresetHint.aggressive"
                    : "slash.compactPresetHint.standard";
              const active = props.preset === id;
              return (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  className={
                    "compact-modal__preset" + (active ? " is-active" : "")
                  }
                  onClick={() => props.onPresetChange(id)}
                >
                  <span className="compact-modal__preset-label">
                    {tr(labelKey)}
                  </span>
                  <span className="compact-modal__preset-hint">
                    {tr(hintKey)}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="compact-modal__cli-fields">
            <div className="compact-modal__field-group">
              <div className="compact-modal__field-label">
                {tr("slash.compactMode")}
              </div>
              <Select
                value={props.compactionMode}
                aria-label={tr("slash.compactMode")}
                onChange={(v) =>
                  props.onCompactionModeChange(normalizeCompactionMode(v))
                }
                options={COMPACTION_MODES.map((id) => ({
                  value: id,
                  label: tr(
                    id === "transcript"
                      ? "settings.compactionMode.transcript"
                      : id === "segments"
                        ? "settings.compactionMode.segments"
                        : "settings.compactionMode.summary",
                  ),
                }))}
              />
            </div>
            <div className="compact-modal__field-group">
              <div className="compact-modal__field-label">
                {tr("slash.compactDetail")}
              </div>
              <Select
                value={props.compactionDetail}
                aria-label={tr("slash.compactDetail")}
                disabled={!compactionDetailApplies(props.compactionMode)}
                onChange={(v) =>
                  props.onCompactionDetailChange(normalizeCompactionDetail(v))
                }
                options={COMPACTION_DETAILS.map((id) => ({
                  value: id,
                  label: tr(
                    id === "none"
                      ? "settings.compactionDetail.none"
                      : id === "minimal"
                        ? "settings.compactionDetail.minimal"
                        : id === "balanced"
                          ? "settings.compactionDetail.balanced"
                          : "settings.compactionDetail.verbose",
                  ),
                }))}
              />
            </div>
          </div>
          <div className="compact-modal__usage" aria-live="polite">
            <div className="compact-modal__usage-row">
              <span className="compact-modal__usage-k">
                {tr("slash.compactBefore")}
              </span>
              <span className="compact-modal__usage-v">
                <span className="compact-modal__usage-tokens">
                  {props.usage.tokens != null
                    ? props.usage.label
                    : tr("slash.compactCurrentUnknown")}
                </span>
                {props.usage.tokens != null ? (
                  <span className="compact-modal__usage-src">
                    {props.usage.source === "known"
                      ? tr("context.sourceKnown")
                      : props.usage.source === "estimated"
                        ? tr("context.sourceEstimated")
                        : tr("context.sourceUnknown")}
                  </span>
                ) : null}
              </span>
            </div>
            {(() => {
              const afterEst = estimateCompactAfterTokens(
                props.usage.tokens,
                props.preset,
              );
              if (afterEst == null) {
                return (
                  <div className="compact-modal__usage-row">
                    <span className="compact-modal__usage-k">
                      {tr("slash.compactAfterEst")}
                    </span>
                    <span className="compact-modal__usage-v">
                      <span className="compact-modal__usage-tokens">
                        {tr("slash.compactAfterUnknown")}
                      </span>
                    </span>
                  </div>
                );
              }
              return (
                <div className="compact-modal__usage-row">
                  <span className="compact-modal__usage-k">
                    {tr("slash.compactAfterEst")}
                  </span>
                  <span className="compact-modal__usage-v">
                    <span className="compact-modal__usage-tokens">
                      ~{formatTokenCount(afterEst, props.locale)}
                    </span>
                    <span className="compact-modal__usage-src">
                      {tr("context.sourceEstimated")}
                    </span>
                  </span>
                </div>
              );
            })()}
            {props.usage.lastCompact &&
            (props.usage.lastCompact.tokensBefore != null ||
              props.usage.lastCompact.tokensAfter != null) ? (
              <div className="compact-modal__usage-row compact-modal__usage-row--last">
                <span className="compact-modal__usage-k">
                  {tr("context.lastCompact")}
                </span>
                <span className="compact-modal__usage-v">
                  <span className="compact-modal__usage-tokens">
                    {formatCompactBeforeAfterRange(
                      props.usage.lastCompact.tokensBefore,
                      props.usage.lastCompact.tokensAfter,
                      {
                        locale: props.locale,
                        template: tr("compact.tokensRange"),
                      },
                    ) ?? tr("context.lastCompactNone")}
                  </span>
                </span>
              </div>
            ) : null}
          </div>
          <div className="compact-modal__field-group">
            <label className="compact-modal__field-label" htmlFor="compact-note">
              {tr("slash.compactNote")}
            </label>
            <input
              id="compact-note"
              ref={props.noteInputRef}
              className="compact-modal__field"
              value={props.note}
              onChange={(e) => props.onNoteChange(e.target.value)}
              placeholder={tr("slash.compactNoteOptional")}
              autoFocus
              autoComplete="off"
            />
            <div
              className="compact-modal__chips"
              role="group"
              aria-label={tr("slash.compactNote")}
            >
              {(
                [
                  "slash.compactNoteChipDecisions",
                  "slash.compactNoteChipErrors",
                  "slash.compactNoteChipFiles",
                  "slash.compactNoteChipTodos",
                ] as const
              ).map((key) => {
                const label = tr(key);
                const active = props.note.trim() === label;
                return (
                  <button
                    key={key}
                    type="button"
                    className={
                      "compact-modal__chip" + (active ? " is-active" : "")
                    }
                    aria-pressed={active}
                    onClick={() =>
                      props.onNoteChange(
                        props.note.trim() === label ? "" : label,
                      )
                    }
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
          {props.turnLive ? (
            <p className="compact-modal__busy" role="status">
              {tr("slash.compactBusy")}
            </p>
          ) : null}
        </div>
        <div className="modal-actions">
          <button
            type="button"
            className="btn btn--ghost"
            onClick={props.onClose}
          >
            {tr("slash.compactConfirmCancel")}
          </button>
          <button
            type="submit"
            className="btn btn--solid"
            disabled={props.turnLive}
          >
            {tr("slash.compactConfirmOk")}
          </button>
        </div>
      </form>
    </div>
  );
}
