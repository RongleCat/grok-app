/**
 * DOCX preview pane — docx-preview (styled Word layout).
 * Lazy-loaded by OfficeDocumentPreview so the renderer only ships when a
 * Word document is actually opened.
 */

import { useEffect, useMemo, useRef } from "react";
import { renderAsync } from "docx-preview";
import { createT, type Locale } from "@/i18n";
import { Tip } from "@/components/ui/tooltip";
import { runAfterPaneSplitMotion } from "@/lib/paneSplitMotion";

export interface OfficeDocxPreviewProps {
  buffer: ArrayBuffer;
  name: string;
  locale: Locale;
  embedded?: boolean;
  onOpenExternal: () => void;
  /** Propagate render failures to the dispatcher's error view. */
  onError: (message: string) => void;
}

export function OfficeDocxPreview({
  buffer,
  name,
  locale,
  embedded = false,
  onOpenExternal,
  onError,
}: OfficeDocxPreviewProps) {
  const tr = useMemo(() => createT(locale), [locale]);
  const docxRef = useRef<HTMLDivElement>(null);
  const docxScrollRef = useRef<HTMLDivElement>(null);

  // Render into the host div — reflow to pane width (full text, no side clip)
  useEffect(() => {
    const el = docxRef.current;
    if (!el) return;
    el.innerHTML = "";
    el.style.zoom = "";
    el.style.transform = "";
    let cancelled = false;
    let ro: ResizeObserver | null = null;

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

    void renderAsync(buffer, el, undefined, {
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
            if (cancelled) return;
            if (runAfterPaneSplitMotion(relaxDocxPageWidths)) return;
            relaxDocxPageWidths();
          });
          ro.observe(scroll);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          onError(e instanceof Error ? e.message : String(e));
        }
      });
    return () => {
      cancelled = true;
      ro?.disconnect();
    };
  }, [buffer, onError]);

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
              onClick={onOpenExternal}
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
