/**
 * Manage multi-root workspace (#1194 MVP-0).
 * Extra roots are read-only; capability banner is honest about CLI disk read.
 */

import { useMemo } from "react";
import { GlassModal } from "@/components/GlassModal";
import { IconPlus } from "@/components/icons";
import { createT, type Locale } from "@/i18n";
import {
  MAX_EXTRA_WORKSPACE_ROOTS,
  extraRoots,
  primaryRoot,
  type WorkspaceRecord,
} from "@/lib/multiRootWorkspace";

type Props = {
  open: boolean;
  locale: Locale;
  busy: boolean;
  error: string | null;
  draft: WorkspaceRecord | null;
  projectName: string;
  onClose: () => void;
  onNameChange: (name: string) => void;
  onAddRoot: () => void;
  onRemoveRoot: (path: string) => void;
  onSave: () => void;
  onClearBinding?: () => void;
};

export function MultiRootWorkspaceModal({
  open,
  locale,
  busy,
  error,
  draft,
  projectName,
  onClose,
  onNameChange,
  onAddRoot,
  onRemoveRoot,
  onSave,
  onClearBinding,
}: Props) {
  const tr = useMemo(() => createT(locale), [locale]);
  const primary = primaryRoot(draft);
  const extras = extraRoots(draft);
  const atCap = extras.length >= MAX_EXTRA_WORKSPACE_ROOTS;

  return (
    <GlassModal
      open={open}
      onClose={onClose}
      title={tr("workspace.multiRoot.title")}
      size="lg"
      wrapBody
      closeLabel={tr("common.cancel")}
      footer={
        <>
          {onClearBinding ? (
            <button
              type="button"
              className="btn ghost"
              disabled={busy}
              onClick={onClearBinding}
            >
              {tr("workspace.multiRoot.clear")}
            </button>
          ) : null}
          <button
            type="button"
            className="btn ghost"
            disabled={busy}
            onClick={onClose}
          >
            {tr("common.cancel")}
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={busy || !draft}
            onClick={onSave}
          >
            {tr("workspace.multiRoot.save")}
          </button>
        </>
      }
    >
      <p className="muted" style={{ marginTop: 0 }}>
        {tr("workspace.multiRoot.bannerContextOnly")}
      </p>
      <label className="field">
        <span className="field-label">{tr("workspace.multiRoot.name")}</span>
        <input
          type="text"
          value={draft?.name ?? ""}
          disabled={busy || !draft}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder={projectName}
        />
      </label>
      <div className="field">
        <span className="field-label">{tr("workspace.multiRoot.primary")}</span>
        <div className="menu-panel glass-panel" style={{ padding: "10px 12px" }}>
          <div style={{ fontWeight: 600 }}>{projectName}</div>
          <div className="muted" style={{ fontSize: 12, wordBreak: "break-all" }}>
            {primary?.path ?? "—"}
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            {tr("workspace.multiRoot.accessWrite")} ·{" "}
            {tr("workspace.multiRoot.rolePrimary")}
          </div>
        </div>
      </div>
      <div className="field">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
          }}
        >
          <span className="field-label">
            {tr("workspace.multiRoot.extras", {
              n: extras.length,
              max: MAX_EXTRA_WORKSPACE_ROOTS,
            })}
          </span>
          <button
            type="button"
            className="btn ghost"
            disabled={busy || !draft || atCap}
            onClick={onAddRoot}
          >
            <IconPlus size={14} aria-hidden /> {tr("workspace.multiRoot.addRoot")}
          </button>
        </div>
        {extras.length === 0 ? (
          <p className="muted" style={{ fontSize: 13 }}>
            {tr("workspace.multiRoot.emptyExtras")}
          </p>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {extras.map((r) => (
              <li
                key={r.path}
                className="menu-panel glass-panel"
                style={{
                  padding: "10px 12px",
                  marginBottom: 8,
                  display: "flex",
                  gap: 8,
                  alignItems: "flex-start",
                  justifyContent: "space-between",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div
                    className="muted"
                    style={{ fontSize: 12, wordBreak: "break-all" }}
                  >
                    {r.path}
                  </div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                    {tr("workspace.multiRoot.accessRead")} ·{" "}
                    {tr("workspace.multiRoot.roleExtra")}
                    {r.pathOk === false
                      ? ` · ${tr("workspace.multiRoot.pathMissing")}`
                      : ""}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn ghost"
                  disabled={busy}
                  onClick={() => onRemoveRoot(r.path)}
                >
                  {tr("workspace.multiRoot.remove")}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {error ? (
        <p className="error" role="alert" style={{ marginBottom: 0 }}>
          {error}
        </p>
      ) : null}
      <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
        {tr("workspace.multiRoot.nextTurnHint")}
      </p>
    </GlassModal>
  );
}
