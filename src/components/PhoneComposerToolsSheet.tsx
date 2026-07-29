/**
 * Phone-only composer tools bottom sheet.
 * Replaces the five unlabeled desktop chips (attach / project / model / access / context)
 * with labelled ≥44px rows. Not mounted on desktop (≥821px).
 */

import { useEffect, useId, useState, type ReactNode } from "react";
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
import {
  GROK_BUILD_EFFORTS,
  GROK_BUILD_MODELS,
  PERMISSION_POLICIES,
  SESSION_MODES,
  type EffortOption,
  type ModelOption,
  type PermissionPolicyId,
} from "@/lib/grokCatalog";
import type { ContextUsageDisplay } from "@/lib/contextUsage";
import { formatTokenCount } from "@/lib/contextUsage";

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
    policyAsk: string;
    policyAcceptEdits: string;
    policySession: string;
    policyDontAsk: string;
    policyYolo: string;
    effortHigh: string;
    effortMedium: string;
    effortLow: string;
    contextCurrent: string;
    contextUnknown: string;
    contextCompact: string;
    sourceKnown: string;
    sourceEstimated: string;
    sourceUnknown: string;
    back: string;
  };
  activeProject: PhoneProjectOption | null;
  projects: PhoneProjectOption[];
  modelId: string;
  effort: string;
  models?: ModelOption[];
  mode: string;
  policy: string;
  contextDisplay: ContextUsageDisplay;
  onAttach: () => void;
  onSelectProject: (project: PhoneProjectOption | null) => void;
  onAddProject: () => void;
  onModel: (id: string) => void;
  onEffort: (id: EffortOption["id"]) => void;
  onMode: (id: string) => void;
  onPolicy: (id: PermissionPolicyId) => void;
  onCompact: () => void;
};

function effortLabel(
  id: string,
  labels: PhoneComposerToolsSheetProps["labels"],
): string {
  if (id === "high") return labels.effortHigh;
  if (id === "medium") return labels.effortMedium;
  return labels.effortLow;
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
  mode,
  policy,
  contextDisplay,
  onAttach,
  onSelectProject,
  onAddProject,
  onModel,
  onEffort,
  onMode,
  onPolicy,
  onCompact,
}: PhoneComposerToolsSheetProps) {
  const titleId = useId();
  const [panel, setPanel] = useState<PhoneToolsPanel>("root");
  const modelList = models.length > 0 ? models : GROK_BUILD_MODELS;
  const modelLabel =
    modelList.find((m) => m.id === modelId)?.label ?? modelId;

  useEffect(() => {
    if (!open) setPanel("root");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      if (panel !== "root") {
        if (panel === "effort") setPanel("model");
        else setPanel("root");
        return;
      }
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, panel, onClose]);

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
                value={`${modelLabel} ${effortLabel(effort, labels)}`}
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
              <SheetRow
                icon={<IconActivity size={20} />}
                label={labels.context}
                value={contextValue}
                chevron
                onClick={() => setPanel("context")}
              />
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
              <div className="phone-sheet__section">{labels.model}</div>
              {modelList.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={
                    "phone-sheet__row" +
                    (m.id === modelId ? " is-active" : "")
                  }
                  onClick={() => onModel(m.id)}
                >
                  <span className="phone-sheet__row-label">{m.label}</span>
                  {m.id === modelId ? (
                    <span className="phone-sheet__row-value" aria-hidden>
                      <IconCheck size={18} />
                    </span>
                  ) : null}
                </button>
              ))}
              <SheetRow
                icon={<IconActivity size={20} />}
                label={labels.effort}
                value={effortLabel(effort, labels)}
                chevron
                onClick={() => setPanel("effort")}
              />
            </>
          )}

          {panel === "effort" &&
            GROK_BUILD_EFFORTS.map((e) => (
              <button
                key={e.id}
                type="button"
                className={
                  "phone-sheet__row" + (e.id === effort ? " is-active" : "")
                }
                onClick={() => {
                  onEffort(e.id);
                  setPanel("model");
                }}
              >
                <span className="phone-sheet__row-label">
                  {effortLabel(e.id, labels)}
                </span>
                {e.id === effort ? (
                  <span className="phone-sheet__row-value" aria-hidden>
                    <IconCheck size={18} />
                  </span>
                ) : null}
              </button>
            ))}

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
