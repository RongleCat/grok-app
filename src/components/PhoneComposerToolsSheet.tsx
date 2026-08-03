/**
 * Phone-only composer tools bottom sheet.
 * Replaces the five unlabeled desktop chips (attach / project / model / access / context)
 * with labelled ≥44px rows. Not mounted on desktop (≥821px).
 */

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  IconActivity,
  IconAttach,
  IconBolt,
  IconCheck,
  IconChevronRight,
  IconClose,
  IconFolder,
  IconHandStop,
  IconPlus,
} from "@/components/icons";
import { installDialogFocus } from "@/lib/a11yFocus";
import {
  GROK_BUILD_EFFORTS,
  GROK_BUILD_MODELS,
  PERMISSION_POLICIES,
  SESSION_MODES,
  effortDisplayLabel,
  effortUiOptionsForCatalog,
  effortsForModel,
  spawnIdToEffortUiSlot,
  type EffortOption,
  type ModelOption,
  type PermissionPolicyId,
} from "@/lib/grokCatalog";
import {
  buildComposerModelGroups,
  isComposerModelEntryActive,
  type ComposerModelPick,
  type ComposerProviderInput,
} from "@/lib/composerModelGroups";
import { composerModelChipLabel } from "@/lib/effectiveModel";
import {
  formatTokenCount,
  hasContextUsageData,
  type ContextUsageDisplay,
} from "@/lib/contextUsage";

export type PhoneToolsPanel =
  | "root"
  | "project"
  | "model"
  | "effort"
  | "access"
  | "context";

export type PhoneProjectOption = {
  id: string;
  name: string;
  path: string;
  trusted: boolean;
};

export type PhoneComposerToolsSheetProps = {
  open: boolean;
  onClose: () => void;
  labels: {
    title: string;
    close: string;
    attach: string;
    project: string;
    model: string;
    effort: string;
    access: string;
    context: string;
    noProject: string;
    addProject: string;
    mode: string;
    permission: string;
    modeAgent: string;
    modePlan: string;
    modeAsk: string;
    /** Section header for official catalog models. */
    modelGroupOfficial: string;
    /** @deprecated Prefer real custom groups via `providers`. */
    modelViaProvider?: string;
    policyAsk: string;
    policyAcceptEdits: string;
    policySession: string;
    policyAuto: string;
    policyDontAsk: string;
    policyYolo: string;
    effortHigh: string;
    effortMedium: string;
    effortLow: string;
    effortXhigh?: string;
    effortMax?: string;
    contextCurrent: string;
    contextUnknown: string;
    contextCompact: string;
    sourceKnown: string;
    sourceEstimated: string;
    sourceUnknown: string;
    /** Context window / percent / cache-hit rows. */
    contextWindow?: string;
    contextPercentUsed?: string;
    contextCacheHit?: string;
    breakdownUser?: string;
    breakdownAssistant?: string;
    breakdownThought?: string;
    back: string;
  };
  activeProject: PhoneProjectOption | null;
  projects: PhoneProjectOption[];
  modelId: string;
  effort: string;
  models?: ModelOption[];
  /** Configured custom providers for grouped menu entries. */
  providers?: ComposerProviderInput[];
  /** Active inference route: official | custom. */
  activeSource?: string;
  activeProviderId?: string | null;
  /** Channel-configured efforts when custom route is active. */
  channelEfforts?: EffortOption[] | null;
  mode: string;
  policy: string;
  contextDisplay: ContextUsageDisplay;
  onAttach: () => void;
  onSelectProject: (project: PhoneProjectOption | null) => void;
  onAddProject: () => void;
  /** Prefer over onModel when provided. */
  onModelPick?: (pick: ComposerModelPick) => void;
  onModel?: (id: string) => void;
  onEffort: (id: EffortOption["id"]) => void;
  onMode: (id: string) => void;
  onPolicy: (id: PermissionPolicyId) => void;
  onCompact: () => void;
};

function effortLabel(
  spawnId: string,
  labels: PhoneComposerToolsSheetProps["labels"],
  catalog?: EffortOption[] | null,
): string {
  const slot = spawnIdToEffortUiSlot(spawnId, catalog);
  return effortDisplayLabel(slot ?? spawnId, {
    high: labels.effortHigh,
    medium: labels.effortMedium,
    low: labels.effortLow,
    xhigh: labels.effortXhigh,
    max: labels.effortMax ?? labels.effortXhigh,
  });
}

function modeLabel(
  id: string,
  labels: PhoneComposerToolsSheetProps["labels"],
): string {
  if (id === "plan") return labels.modePlan;
  if (id === "ask") return labels.modeAsk;
  return labels.modeAgent;
}

function policyLabel(
  id: string,
  labels: PhoneComposerToolsSheetProps["labels"],
): string {
  switch (id) {
    case "accept_edits":
      return labels.policyAcceptEdits;
    case "allow_for_session":
      return labels.policySession;
    case "auto":
      return labels.policyAuto;
    case "dont_ask":
      return labels.policyDontAsk;
    case "always_approve":
      return labels.policyYolo;
    default:
      return labels.policyAsk;
  }
}

function SheetRow({
  icon,
  label,
  value,
  onClick,
  chevron,
}: {
  icon: ReactNode;
  label: string;
  value?: string;
  onClick: () => void;
  chevron?: boolean;
}) {
  return (
    <button type="button" className="phone-sheet__row" onClick={onClick}>
      <span className="phone-sheet__row-icon" aria-hidden>
        {icon}
      </span>
      <span className="phone-sheet__row-label">{label}</span>
      {value ? (
        <span className="phone-sheet__row-value">{value}</span>
      ) : null}
      {chevron ? (
        <span className="phone-sheet__row-chevron" aria-hidden>
          <IconChevronRight size={18} />
        </span>
      ) : null}
    </button>
  );
}

export function PhoneComposerToolsSheet({
  open,
  onClose,
  labels,
  activeProject,
  projects,
  modelId,
  effort,
  models = GROK_BUILD_MODELS,
  providers = [],
  activeSource = "official",
  activeProviderId = null,
  channelEfforts = null,
  mode,
  policy,
  contextDisplay,
  onAttach,
  onSelectProject,
  onAddProject,
  onModelPick,
  onModel,
  onEffort,
  onMode,
  onPolicy,
  onCompact,
}: PhoneComposerToolsSheetProps) {
  const titleId = useId();
  const [panel, setPanel] = useState<PhoneToolsPanel>("root");
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const toolsPanelRef = useRef(panel);
  toolsPanelRef.current = panel;
  const modelList = models.length > 0 ? models : GROK_BUILD_MODELS;
  const modelGroups = buildComposerModelGroups({
    officialModels: modelList,
    providers,
    officialGroupTitle: labels.modelGroupOfficial,
  });
  const activeCustom =
    activeSource === "custom" && activeProviderId
      ? (() => {
          const p = providers.find((x) => x.id === activeProviderId);
          if (!p) return null;
          const activeId = p.model?.trim() ?? "";
          const entry =
            p.models?.find((m) => m.id === activeId) ??
            (activeId ? { id: activeId, name: activeId } : null);
          return entry
            ? { name: entry.name || entry.id, model: entry.id }
            : { name: p.name, model: p.model };
        })()
      : null;
  const activeRequestModel =
    activeSource === "custom"
      ? providers.find((x) => x.id === activeProviderId)?.model ?? null
      : null;
  const effortCatalog =
    activeSource === "custom" && channelEfforts && channelEfforts.length > 0
      ? effortsForModel(null, channelEfforts)
      : GROK_BUILD_EFFORTS;
  const effortUiList = effortUiOptionsForCatalog(effortCatalog);
  const officialLabel =
    modelList.find((m) => m.id === modelId)?.label ?? modelId;
  const modelLabel = composerModelChipLabel({
    modelId,
    officialLabel,
    activeCustom,
  });

  const selectPick = (pick: ComposerModelPick) => {
    if (onModelPick) {
      onModelPick(pick);
    } else if (pick.kind === "official" && onModel) {
      onModel(pick.modelId);
    }
    onClose();
  };

  useEffect(() => {
    if (!open) setPanel("root");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    // Escape: drill up sub-panels, then close. Tab cycles inside the sheet.
    return installDialogFocus(() => panelRef.current, {
      onEscape: () => {
        const p = toolsPanelRef.current;
        if (p !== "root") {
          if (p === "effort") setPanel("model");
          else setPanel("root");
          return;
        }
        onCloseRef.current();
      },
      capture: true,
      initialFocus: "first",
      restoreFocus: true,
    });
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  // Prefer pre-resolved chip label (already locale-aware Chinese units).
  const contextValue =
    contextDisplay.tokens != null
      ? contextDisplay.label.replace(/^~/, "") ||
        formatTokenCount(contextDisplay.tokens)
      : labels.contextUnknown;

  const headerTitle =
    panel === "root"
      ? labels.title
      : panel === "project"
        ? labels.project
        : panel === "model"
          ? labels.model
          : panel === "effort"
            ? labels.effort
            : panel === "access"
              ? labels.access
              : labels.context;

  return createPortal(
    <div className="phone-sheet" role="presentation">
      <button
        type="button"
        className="phone-sheet__scrim"
        aria-label={labels.close}
        onClick={onClose}
      />
      <div
        ref={panelRef}
        className="phone-sheet__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="phone-sheet__handle" aria-hidden />
        <div className="phone-sheet__head">
          {panel !== "root" ? (
            <button
              type="button"
              className="phone-sheet__icon-btn"
              onClick={() =>
                setPanel(panel === "effort" ? "model" : "root")
              }
              aria-label={labels.back}
            >
              <IconClose size={18} />
            </button>
          ) : (
            <span className="phone-sheet__icon-btn phone-sheet__icon-btn--spacer" />
          )}
          <h2 id={titleId} className="phone-sheet__title">
            {headerTitle}
          </h2>
          <button
            type="button"
            className="phone-sheet__icon-btn"
            onClick={onClose}
            aria-label={labels.close}
          >
            <IconClose size={18} />
          </button>
        </div>

        <div className="phone-sheet__body">
          {panel === "root" && (
            <>
              <SheetRow
                icon={<IconAttach size={20} />}
                label={labels.attach}
                onClick={() => {
                  onAttach();
                  onClose();
                }}
              />
              <SheetRow
                icon={<IconFolder size={20} />}
                label={labels.project}
                value={activeProject?.name ?? labels.noProject}
                chevron
                onClick={() => setPanel("project")}
              />
              <SheetRow
                icon={<IconBolt size={20} />}
                label={labels.model}
                value={`${modelLabel} ${effortLabel(effort, labels, effortCatalog)}`}
                chevron
                onClick={() => setPanel("model")}
              />
              <SheetRow
                icon={<IconHandStop size={20} />}
                label={labels.access}
                value={`${modeLabel(mode, labels)} · ${policyLabel(policy, labels)}`}
                chevron
                onClick={() => setPanel("access")}
              />
              {hasContextUsageData(contextDisplay) ? (
                <SheetRow
                  icon={<IconActivity size={20} />}
                  label={labels.context}
                  value={contextValue}
                  chevron
                  onClick={() => setPanel("context")}
                />
              ) : null}
            </>
          )}

          {panel === "project" && (
            <>
              <SheetRow
                icon={<IconCheck size={20} />}
                label={labels.noProject}
                onClick={() => {
                  onSelectProject(null);
                  onClose();
                }}
              />
              {projects.map((p) => (
                <SheetRow
                  key={p.id}
                  icon={<IconFolder size={20} />}
                  label={p.name}
                  value={activeProject?.id === p.id ? "✓" : undefined}
                  onClick={() => {
                    onSelectProject(p);
                    onClose();
                  }}
                />
              ))}
              <SheetRow
                icon={<IconPlus size={20} />}
                label={labels.addProject}
                onClick={() => {
                  onAddProject();
                  onClose();
                }}
              />
            </>
          )}

          {panel === "model" && (
            <>
              {modelGroups.map((group) => (
                <div key={group.key}>
                  <div className="phone-sheet__section">{group.title}</div>
                  {group.entries.map((entry) => {
                    const active = isComposerModelEntryActive(entry, {
                      activeSource,
                      activeProviderId,
                      activeRequestModel,
                      modelId,
                    });
                    return (
                      <button
                        key={entry.key}
                        type="button"
                        className={
                          "phone-sheet__row" +
                          (active ? " is-active" : "") +
                          (entry.subtitle ? " phone-sheet__row--stacked" : "")
                        }
                        onClick={() => selectPick(entry.pick)}
                      >
                        <span className="phone-sheet__row-label">
                          {entry.subtitle ? (
                            <>
                              <span className="phone-sheet__row-title">
                                {entry.title}
                              </span>
                              <span className="phone-sheet__row-sub">
                                {entry.subtitle}
                              </span>
                            </>
                          ) : (
                            entry.title
                          )}
                        </span>
                        {active ? (
                          <span className="phone-sheet__row-value" aria-hidden>
                            <IconCheck size={18} />
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ))}
              <SheetRow
                icon={<IconActivity size={20} />}
                label={labels.effort}
                value={effortLabel(effort, labels, effortCatalog)}
                chevron
                onClick={() => setPanel("effort")}
              />
            </>
          )}

          {panel === "effort" &&
            effortUiList.map((e) => {
              const active =
                e.spawnId === effort ||
                spawnIdToEffortUiSlot(effort, effortCatalog) === e.uiId;
              return (
                <button
                  key={e.uiId}
                  type="button"
                  className={
                    "phone-sheet__row" + (active ? " is-active" : "")
                  }
                  onClick={() => {
                    onEffort(e.spawnId);
                    setPanel("model");
                  }}
                >
                  <span className="phone-sheet__row-label">
                    {effortDisplayLabel(e.uiId, {
                      high: labels.effortHigh,
                      medium: labels.effortMedium,
                      low: labels.effortLow,
                      xhigh: labels.effortXhigh,
                      max: labels.effortMax ?? labels.effortXhigh,
                    })}
                  </span>
                  {active ? (
                    <span className="phone-sheet__row-value" aria-hidden>
                      <IconCheck size={18} />
                    </span>
                  ) : null}
                </button>
              );
            })}

          {panel === "access" && (
            <>
              <div className="phone-sheet__section">{labels.mode}</div>
              {SESSION_MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={
                    "phone-sheet__row" + (m.id === mode ? " is-active" : "")
                  }
                  onClick={() => onMode(m.id)}
                >
                  <span className="phone-sheet__row-label">
                    {modeLabel(m.id, labels)}
                  </span>
                  {m.id === mode ? (
                    <span className="phone-sheet__row-value" aria-hidden>
                      <IconCheck size={18} />
                    </span>
                  ) : null}
                </button>
              ))}
              <div className="phone-sheet__section">{labels.permission}</div>
              {PERMISSION_POLICIES.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={
                    "phone-sheet__row" +
                    (p.id === policy ? " is-active" : "")
                  }
                  onClick={() => onPolicy(p.id as PermissionPolicyId)}
                >
                  <span className="phone-sheet__row-label">
                    {policyLabel(p.id, labels)}
                  </span>
                  {p.id === policy ? (
                    <span className="phone-sheet__row-value" aria-hidden>
                      <IconCheck size={18} />
                    </span>
                  ) : null}
                </button>
              ))}
            </>
          )}

          {panel === "context" && (
            <>
              <div className="phone-sheet__info">
                <div className="phone-sheet__info-row">
                  <span>{labels.contextCurrent}</span>
                  <strong>{contextValue}</strong>
                </div>
                <div className="phone-sheet__info-row">
                  <span>
                    {contextDisplay.source === "known"
                      ? labels.sourceKnown
                      : contextDisplay.source === "estimated"
                        ? labels.sourceEstimated
                        : labels.sourceUnknown}
                  </span>
                </div>
                {contextDisplay.windowSize != null &&
                contextDisplay.windowSize > 0 ? (
                  <div className="phone-sheet__info-row">
                    <span>{labels.contextWindow}</span>
                    <strong className="phone-sheet__nums">
                      {formatTokenCount(contextDisplay.windowSize)}
                    </strong>
                  </div>
                ) : null}
                {contextDisplay.percent != null ? (
                  <div className="phone-sheet__info-row">
                    <span>{labels.contextPercentUsed}</span>
                    <strong className="phone-sheet__nums">
                      {contextDisplay.percent}%
                    </strong>
                  </div>
                ) : null}
                {contextDisplay.cacheHitRate != null ? (
                  <div className="phone-sheet__info-row">
                    <span>{labels.contextCacheHit}</span>
                    <strong className="phone-sheet__nums">
                      {contextDisplay.cacheHitRate}%
                    </strong>
                  </div>
                ) : null}
                {contextDisplay.breakdown && labels.breakdownUser
                  ? [
                      "user",
                      "assistant",
                      "thought",
                    ].map((role) => {
                      const tokens =
                        role === "user"
                          ? contextDisplay.breakdown!.userTokens
                          : role === "assistant"
                            ? contextDisplay.breakdown!.assistantTokens
                            : contextDisplay.breakdown!.thoughtTokens;
                      if (tokens <= 0) return null;
                      const lab =
                        role === "user"
                          ? labels.breakdownUser
                          : role === "assistant"
                            ? labels.breakdownAssistant
                            : labels.breakdownThought;
                      return (
                        <div
                          key={role}
                          className="phone-sheet__info-row"
                        >
                          <span>{lab}</span>
                          <strong className="phone-sheet__nums">
                            ~{formatTokenCount(tokens)}
                          </strong>
                        </div>
                      );
                    })
                  : null}
              </div>
              <SheetRow
                icon={<IconActivity size={20} />}
                label={labels.contextCompact}
                onClick={() => {
                  onCompact();
                  onClose();
                }}
              />
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
