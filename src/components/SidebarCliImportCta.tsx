/**
 * Empty-sidebar affordance: import Grok Build CLI sessions into App chats.
 */
export function SidebarCliImportCta({
  hint,
  importLabel,
  browseLabel,
  importing,
  onImport,
  onBrowse,
}: {
  hint: string;
  importLabel: string;
  browseLabel: string;
  importing: boolean;
  onImport: () => void;
  onBrowse: () => void;
}) {
  return (
    <div className="sidebar-cli-import">
      <div className="sidebar-empty__hint">{hint}</div>
      <div className="sidebar-empty__actions">
        <button
          type="button"
          className="btn btn--solid btn--sm"
          disabled={importing}
          onClick={onImport}
        >
          {importLabel}
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          disabled={importing}
          onClick={onBrowse}
        >
          {browseLabel}
        </button>
      </div>
    </div>
  );
}
