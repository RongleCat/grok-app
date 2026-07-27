/**
 * Rich local document preview:
 * - PDF  → react-pdf (pdf.js)
 * - DOCX → docx-preview (styled Word layout)
 * - XLSX → SheetJS (xlsx) multi-sheet tables
 * - PPTX → limited text fallback + open externally
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { renderAsync } from "docx-preview";
import * as XLSX from "xlsx";
import { fetchPreviewArrayBuffer } from "@/lib/filePreviewSrc";
import { createT, type Locale } from "@/i18n";
import { openInEditor, pathOpen, pathReveal } from "@/lib/api";
import { Tip } from "@/components/ui/tooltip";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export interface OfficeDocumentPreviewProps {
  kind: string;
  absolutePath: string;
  name: string;
  locale: Locale;
  /** Plain-text extract from host (pptx / fallback). */
  textFallback?: string | null;
  errorFromHost?: string | null;
  /**
   * When true (ResourceViewer embed), hide the filename title bar so the host
   * chrome is the only place that shows the file name / open actions.
   * PDF still shows page/zoom controls without a title.
   */
  embedded?: boolean;
}

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; buffer: ArrayBuffer };

export function OfficeDocumentPreview({
  kind,
  absolutePath,
  name,
  locale,
  textFallback,
  errorFromHost,
  embedded = false,
}: OfficeDocumentPreviewProps) {
  const tr = useMemo(() => createT(locale), [locale]);
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [pdfPages, setPdfPages] = useState(0);
  const [pdfPage, setPdfPage] = useState(1);
  const [pdfScale, setPdfScale] = useState(1.05);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [activeSheet, setActiveSheet] = useState(0);
  const [sheetRows, setSheetRows] = useState<string[][]>([]);
  const docxRef = useRef<HTMLDivElement>(null);
  const docxScrollRef = useRef<HTMLDivElement>(null);

  /**
   * Force pages to use the pane width so text/tables reflow instead of
   * clipping (docx-preview writes fixed page widths as inline styles).
   */
  const relaxDocxPageWidths = () => {
    const host = docxRef.current;
    if (!host) return;
    host.querySelectorAll<HTMLElement>("section.docx").forEach((sec) => {
      sec.style.setProperty("width", "100%", "important");
      sec.style.setProperty("max-width", "100%", "important");
      sec.style.setProperty("min-width", "0", "important");
      sec.style.setProperty("box-sizing", "border-box", "important");
    });
    const wrap = host.querySelector<HTMLElement>(".docx-wrapper");
    if (wrap) {
      wrap.style.setProperty("width", "100%", "important");
      wrap.style.setProperty("max-width", "100%", "important");
      wrap.style.setProperty("padding", "0", "important");
    }
  };

  useEffect(() => {
    let cancelled = false;
    setLoad({ status: "loading" });
    setPdfPages(0);
    setPdfPage(1);
    setSheetNames([]);
    setActiveSheet(0);
    setSheetRows([]);

    if (errorFromHost && !absolutePath) {
      setLoad({ status: "error", message: errorFromHost });
      return;
    }

    // pptx: no mature free browser renderer — prefer text + open
    if (kind === "pptx" || kind === "odf") {
      setLoad({
        status: "error",
        message: tr("office.pptxLimited"),
      });
      return;
    }

    void (async () => {
      try {
        const buf = await fetchPreviewArrayBuffer(absolutePath, kind);
        if (cancelled) return;
        setLoad({ status: "ready", buffer: buf });
      } catch (e) {
        if (cancelled) return;
        setLoad({
          status: "error",
          message: e instanceof Error ? e.message : String(e),
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [absolutePath, kind, errorFromHost, tr]);

  // DOCX render — reflow to pane width (full text, no side clip)
  useEffect(() => {
    if (load.status !== "ready") return;
    if (kind !== "docx" && kind !== "office") return;
    const el = docxRef.current;
    if (!el) return;
    el.innerHTML = "";
    el.style.zoom = "";
    el.style.transform = "";
    let cancelled = false;
    let ro: ResizeObserver | null = null;

    void renderAsync(load.buffer, el, undefined, {
      className: "office-docx-body",
      inWrapper: true,
      // Critical: ignore fixed page width so content uses the container
      // (otherwise Chinese titles / tables overflow and get clipped).
      ignoreWidth: true,
      ignoreHeight: true,
      breakPages: true,
      renderHeaders: true,
      renderFooters: true,
      renderFootnotes: true,
      useBase64URL: true,
      experimental: true,
    })
      .then(() => {
        if (cancelled) return;
        relaxDocxPageWidths();
        requestAnimationFrame(() => {
          if (!cancelled) relaxDocxPageWidths();
        });
        // Images can change layout after load
        el.querySelectorAll("img").forEach((img) => {
          if (img.complete) return;
          img.addEventListener(
            "load",
            () => {
              if (!cancelled) relaxDocxPageWidths();
            },
            { once: true },
          );
        });
        const scroll = docxScrollRef.current;
        if (scroll && typeof ResizeObserver !== "undefined") {
          ro = new ResizeObserver(() => {
            if (!cancelled) relaxDocxPageWidths();
          });
          ro.observe(scroll);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setLoad({
            status: "error",
            message: e instanceof Error ? e.message : String(e),
          });
        }
      });
    return () => {
      cancelled = true;
      ro?.disconnect();
    };
  }, [load, kind]);

  // XLSX parse
  useEffect(() => {
    if (load.status !== "ready") return;
    if (kind !== "xlsx") return;
    try {
      const wb = XLSX.read(load.buffer, { type: "array" });
      const names = wb.SheetNames;
      setSheetNames(names);
      const idx = 0;
      setActiveSheet(idx);
      const ws = wb.Sheets[names[idx]];
      if (ws) {
        const rows = XLSX.utils.sheet_to_json<string[]>(ws, {
          header: 1,
          defval: "",
          raw: false,
        }) as string[][];
        setSheetRows(rows.map((r) => r.map((c) => (c == null ? "" : String(c)))));
      } else {
        setSheetRows([]);
      }
    } catch (e) {
      setLoad({
        status: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }, [load, kind]);

  const switchSheet = (idx: number) => {
    if (load.status !== "ready" || kind !== "xlsx") return;
    try {
      const wb = XLSX.read(load.buffer, { type: "array" });
      const name = wb.SheetNames[idx];
      const ws = wb.Sheets[name];
      setActiveSheet(idx);
      if (ws) {
        const rows = XLSX.utils.sheet_to_json<string[]>(ws, {
          header: 1,
          defval: "",
          raw: false,
        }) as string[][];
        setSheetRows(rows.map((r) => r.map((c) => (c == null ? "" : String(c)))));
      } else {
        setSheetRows([]);
      }
    } catch (e) {
      setLoad({
        status: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const openExternal = async () => {
    try {
      await pathOpen(absolutePath);
    } catch {
      try {
        await openInEditor({ path: absolutePath });
      } catch {
        await pathReveal(absolutePath);
      }
    }
  };

  if (load.status === "loading") {
    return (
      <div className="office-preview office-preview--center">
        <div className="office-preview__status">{tr("office.loading")}</div>
        {!embedded ? (
          <div className="office-preview__sub">{name}</div>
        ) : null}
      </div>
    );
  }

  if (load.status === "error") {
    return (
      <div className="office-preview office-preview--center">
        <div className="office-preview__status">{tr("office.renderFailed")}</div>
        <div className="office-preview__sub">{load.message}</div>
        {textFallback ? (
          <pre className="office-preview__fallback">{textFallback}</pre>
        ) : null}
        <div className="office-preview__actions">
          <button type="button" className="btn btn--solid" onClick={() => void openExternal()}>
            {tr("office.openExternal")}
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => void pathReveal(absolutePath)}>
            {tr("resources.revealFolder")}
          </button>
        </div>
      </div>
    );
  }

  // PDF — page/zoom chrome only; filename/open live in host when embedded
  if (kind === "pdf") {
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
                onClick={() => void openExternal()}
              >
                {tr("office.openExternal")}
              </button>
            )}
          </div>
        </div>
        <div className="office-preview__pdf-scroll">
          <Document
            file={{ data: new Uint8Array(load.buffer) }}
            onLoadSuccess={(d) => {
              setPdfPages(d.numPages);
              setPdfPage(1);
            }}
            loading={
              <div className="office-preview__status">{tr("office.loading")}</div>
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

  // DOCX — pure document body when embedded (no filename bar)
  if (kind === "docx" || kind === "office") {
    return (
      <div
        className={
          "office-preview office-preview--docx" +
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
                onClick={() => void openExternal()}
              >
                {tr("office.openExternal")}
              </button>
            </div>
          </div>
        )}
        <div
          ref={docxScrollRef}
          className="office-preview__docx-scroll"
        >
          <div ref={docxRef} className="office-docx-host" />
        </div>
      </div>
    );
  }

  // XLSX — sheet tabs only when embedded; no filename title
  if (kind === "xlsx") {
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
                onClick={() => void openExternal()}
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
        <div className="office-preview__sheet-scroll">
          <table className="office-preview__sheet-table">
            <tbody>
              {sheetRows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => (
                    <td key={ci}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div className="office-preview office-preview--center">
      <div className="office-preview__status">{tr("office.unsupported")}</div>
      <button type="button" className="btn btn--solid" onClick={() => void openExternal()}>
        {tr("office.openExternal")}
      </button>
    </div>
  );
}
