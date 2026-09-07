/**
 * PDF preview pane — react-pdf (pdf.js) with page/zoom chrome.
 * Lazy-loaded by OfficeDocumentPreview so pdfjs + the worker only ship
 * when a PDF is actually opened.
 */

import { useMemo, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { createT, type Locale } from "@/i18n";
import { Tip } from "@/components/ui/tooltip";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export interface OfficePdfPreviewProps {
  buffer: ArrayBuffer;
  name: string;
  locale: Locale;
  embedded?: boolean;
  onOpenExternal: () => void;
}

export function OfficePdfPreview({
  buffer,
  name,
  locale,
  embedded = false,
  onOpenExternal,
}: OfficePdfPreviewProps) {
  const tr = useMemo(() => createT(locale), [locale]);
  const [pdfPages, setPdfPages] = useState(0);
  const [pdfPage, setPdfPage] = useState(1);
  const [pdfScale, setPdfScale] = useState(1.05);

  /**
   * Stable react-pdf `file` prop. Inline `new Uint8Array(...)` every render
   * remounts Document in a tight loop (GPU thrash → full-window black freeze
   * when users open a generated PDF from chat).
   */
  const pdfFile = useMemo(() => ({ data: new Uint8Array(buffer) }), [buffer]);

  return (
    <div className="office-preview office-preview--pdf">
      <div className="office-preview__bar office-preview__bar--controls">
        {!embedded ? (
          <Tip label={name}>
            <span className="office-preview__bar-title">
              {name}
            </span>
          </Tip>
        ) : (
          <span className="office-preview__bar-spacer" />
        )}
        <div className="office-preview__bar-actions">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={pdfPage <= 1}
            onClick={() => setPdfPage((p) => Math.max(1, p - 1))}
          >
            {tr("office.prevPage")}
          </button>
          <span className="office-preview__page">
            {pdfPages
              ? tr("office.pageOf", { page: pdfPage, total: pdfPages })
              : "—"}
          </span>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={!pdfPages || pdfPage >= pdfPages}
            onClick={() =>
              setPdfPage((p) => (pdfPages ? Math.min(pdfPages, p + 1) : p))
            }
          >
            {tr("office.nextPage")}
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => setPdfScale((s) => Math.max(0.6, s - 0.1))}
          >
            −
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => setPdfScale((s) => Math.min(2.2, s + 0.1))}
          >
            +
          </button>
          {!embedded && (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={onOpenExternal}
            >
              {tr("office.openExternal")}
            </button>
          )}
        </div>
      </div>
      <div className="office-preview__pdf-scroll">
        <Document
          file={pdfFile}
          onLoadSuccess={(d) => {
            setPdfPages(d.numPages);
            setPdfPage(1);
          }}
          loading={
            <div className="office-preview__status">
              {tr("office.loading")}
            </div>
          }
          error={
            <div className="office-preview__status">
              {tr("office.renderFailed")}
            </div>
          }
        >
          <Page
            pageNumber={pdfPage}
            scale={pdfScale}
            renderTextLayer
            renderAnnotationLayer
          />
        </Document>
      </div>
    </div>
  );
}
