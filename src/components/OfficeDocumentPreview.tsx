/**
 * Rich local document preview — dispatcher.
 * - PDF  → OfficePdfPreview (react-pdf, lazy)
 * - DOCX → OfficeDocxPreview (docx-preview, lazy)
 * - XLSX → OfficeXlsxPreview (SheetJS, lazy)
 * - PPTX → limited text fallback + open externally
 *
 * Fetching / error / fallback chrome lives here so each format's renderer
 * only ships (and parses) when that file type is actually opened.
 */

import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { fetchPreviewArrayBuffer } from "@/lib/filePreviewSrc";
import {
  formatMediaLoadErrorMessage,
  resolveMediaLoadError,
} from "@/lib/mediaLoadPro";
import { createT, type Locale } from "@/i18n";
import { openInEditor, pathOpen, pathReveal } from "@/lib/api";

const OfficePdfPreview = lazy(async () => {
  const m = await import("@/components/OfficePdfPreview");
  return { default: m.OfficePdfPreview };
});
const OfficeDocxPreview = lazy(async () => {
  const m = await import("@/components/OfficeDocxPreview");
  return { default: m.OfficeDocxPreview };
});
const OfficeXlsxPreview = lazy(async () => {
  const m = await import("@/components/OfficeXlsxPreview");
  return { default: m.OfficeXlsxPreview };
});

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

  useEffect(() => {
    let cancelled = false;
    setLoad({ status: "loading" });

    if (errorFromHost) {
      const resolved = resolveMediaLoadError(errorFromHost, "office");
      setLoad({
        status: "error",
        message: formatMediaLoadErrorMessage(resolved, tr),
      });
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

    const controller = new AbortController();
    void (async () => {
      try {
        const buf = await fetchPreviewArrayBuffer(
          absolutePath,
          kind,
          controller.signal,
        );
        if (cancelled) return;
        setLoad({ status: "ready", buffer: buf });
      } catch (e) {
        if (cancelled) return;
        // Soft-fail: classified media.err.* copy, never crash the pane.
        const resolved = resolveMediaLoadError(e, "office");
        setLoad({
          status: "error",
          message: formatMediaLoadErrorMessage(resolved, tr),
        });
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [absolutePath, kind, errorFromHost, tr]);

  const openExternal = useCallback(async () => {
    try {
      await pathOpen(absolutePath);
    } catch {
      try {
        await openInEditor({ path: absolutePath });
      } catch {
        await pathReveal(absolutePath);
      }
    }
  }, [absolutePath]);

  const handleChildError = useCallback((message: string) => {
    setLoad({ status: "error", message });
  }, []);

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

  const child = (() => {
    if (kind === "pdf") {
      return (
        <OfficePdfPreview
          buffer={load.buffer}
          name={name}
          locale={locale}
          embedded={embedded}
          onOpenExternal={() => void openExternal()}
        />
      );
    }
    if (kind === "docx" || kind === "office") {
      return (
        <OfficeDocxPreview
          buffer={load.buffer}
          name={name}
          locale={locale}
          embedded={embedded}
          onOpenExternal={() => void openExternal()}
          onError={handleChildError}
        />
      );
    }
    if (kind === "xlsx") {
      return (
        <OfficeXlsxPreview
          buffer={load.buffer}
          name={name}
          locale={locale}
          embedded={embedded}
          onOpenExternal={() => void openExternal()}
          onError={handleChildError}
        />
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
  })();

  return (
    <Suspense
      fallback={
        <div className="office-preview office-preview--center">
          <div className="office-preview__status">{tr("office.loading")}</div>
          {!embedded ? (
            <div className="office-preview__sub">{name}</div>
          ) : null}
        </div>
      }
    >
      {child}
    </Suspense>
  );
}
