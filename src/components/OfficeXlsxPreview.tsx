/**
 * XLSX preview pane — SheetJS multi-sheet HTML tables.
 * Lazy-loaded by OfficeDocumentPreview so the xlsx bundle only ships when an
 * Excel sheet is actually opened.
 */

import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { createT, type Locale } from "@/i18n";
import { Tip } from "@/components/ui/tooltip";
import { sanitizeOfficeSheetHtml } from "@/lib/sanitizeOfficeHtml";

export interface OfficeXlsxPreviewProps {
  buffer: ArrayBuffer;
  name: string;
  locale: Locale;
  embedded?: boolean;
  onOpenExternal: () => void;
  /** Propagate parse errors to the dispatcher's error view. */
  onError: (message: string) => void;
}

export function OfficeXlsxPreview({
  buffer,
  name,
  locale,
  embedded = false,
  onOpenExternal,
  onError,
}: OfficeXlsxPreviewProps) {
  const tr = useMemo(() => createT(locale), [locale]);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [activeSheet, setActiveSheet] = useState(0);
  const [sheetHtml, setSheetHtml] = useState("");

  useEffect(() => {
    try {
      const wb = XLSX.read(buffer, { type: "array" });
      const names = wb.SheetNames;
      setSheetNames(names);
      const idx = 0;
      setActiveSheet(idx);
      const ws = wb.Sheets[names[idx]];
      setSheetHtml(
        ws
          ? sanitizeOfficeSheetHtml(
              XLSX.utils.sheet_to_html(ws, { id: "office-sheet" }),
            )
          : "",
      );
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  }, [buffer, onError]);

  const switchSheet = (idx: number) => {
    try {
      const wb = XLSX.read(buffer, { type: "array" });
      const sheetName = wb.SheetNames[idx];
      const ws = wb.Sheets[sheetName];
      setActiveSheet(idx);
      setSheetHtml(
        ws
          ? sanitizeOfficeSheetHtml(
              XLSX.utils.sheet_to_html(ws, { id: "office-sheet" }),
            )
          : "",
      );
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div
      className={
        "office-preview office-preview--xlsx" +
        (embedded ? " office-preview--embedded" : "")
      }
    >
      {!embedded && (
        <div className="office-preview__bar">
          <Tip label={name}>
            <span className="office-preview__bar-title">
              {name}
            </span>
          </Tip>
          <div className="office-preview__bar-actions">
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={onOpenExternal}
            >
              {tr("office.openExternal")}
            </button>
          </div>
        </div>
      )}
      {sheetNames.length > 1 && (
        <div className="office-preview__sheets" role="tablist">
          {sheetNames.map((sn, i) => (
            <button
              key={sn}
              type="button"
              role="tab"
              className={
                "office-preview__sheet-tab" +
                (i === activeSheet ? " is-active" : "")
              }
              onClick={() => switchSheet(i)}
            >
              {sn}
            </button>
          ))}
        </div>
      )}
      <div
        className="office-preview__sheet-scroll"
        dangerouslySetInnerHTML={{ __html: sheetHtml }}
      />
    </div>
  );
}
