import { useMemo } from "react";
import type { Locale } from "@/i18n";
import { createT } from "@/i18n";
import { GlassModal } from "@/components/GlassModal";
import { mcpMetaLine } from "@/lib/extensionsUi";

export type McpServerRow = {
  name: string;
  transport?: string | null;
  target?: string | null;
  vendor?: string | null;
  compatibilityStatus?: string | null;
};

export function McpStatusModal({
  open,
  locale,
  servers,
  error,
  loading,
  onClose,
  onManage,
}: {
  open: boolean;
  locale: Locale;
  servers: McpServerRow[];
  error?: string | null;
  loading?: boolean;
  onClose: () => void;
  /** Open Settings → Extensions for full Skills/MCP management. */
  onManage?: () => void;
}) {
  const tr = useMemo(() => createT(locale), [locale]);

  return (
    <GlassModal
      open={open}
      onClose={onClose}
      title={tr("mcpModal.title")}
      titleId="mcp-modal-title"
      closeLabel={tr("common.close")}
      size="md"
      className="mcp-modal"
      footer={
        <div className="mcp-modal__footer">
          {onManage ? (
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => {
                onManage();
                onClose();
              }}
            >
              {tr("mcpModal.manage")}
            </button>
          ) : null}
          <button type="button" className="btn btn--solid" onClick={onClose}>
            {tr("common.close")}
          </button>
        </div>
      }
    >
      <p className="mcp-modal__hint">{tr("mcpModal.hint")}</p>
      {loading && <p className="modal-status">{tr("mcpModal.loading")}</p>}
      {error && (
        <p className="modal-status modal-status--error">{error}</p>
      )}
      {!loading && servers.length === 0 && !error && (
        <p className="modal-status">{tr("mcpModal.empty")}</p>
      )}
      {servers.length > 0 ? (
        <ul className="mcp-modal__list">
          {servers.map((s) => {
            const meta = mcpMetaLine(s);
            return (
              <li key={s.name} className="mcp-modal__item">
                <strong>{s.name}</strong>
                {meta ? <span>{meta}</span> : null}
                {s.target ? <em title={s.target}>{s.target}</em> : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </GlassModal>
  );
}
