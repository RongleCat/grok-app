/**
 * Note + file card under a spilled (preview-only) assistant body.
 * Writes the full reply once via save_temp_attachment; remounts reuse cache
 * so the virtual list does not create a new paste file every scroll.
 */

import { useEffect, useMemo, useState } from "react";
import type { Locale } from "@/i18n";
import { createT } from "@/i18n";
import * as api from "@/lib/api";
import { FilePathCard } from "@/components/FilePathCard";
import { revealInOsLabel } from "@/lib/appPlatform";
import {
  getCachedSpillPath,
  safeSpillFileStem,
  setCachedSpillPath,
  spillCacheKey,
  utf8ToBase64,
} from "@/lib/longAssistantSpill";
import type { ResourceOpenTarget } from "@/components/resource-viewer/types";

export function LongAssistantSpillNote({
  fullText,
  streaming,
  locale,
  messageId,
  projectPath,
  expanded,
  onToggleExpanded,
  onOpenResource,
  onOpenError,
}: {
  fullText: string;
  streaming: boolean;
  locale: Locale;
  messageId?: string;
  projectPath?: string | null;
  expanded?: boolean;
  onToggleExpanded?: () => void;
  onOpenResource?: (target: ResourceOpenTarget) => void;
  onOpenError?: (message: string) => void;
}) {
  const tr = useMemo(() => createT(locale), [locale]);
  const key = spillCacheKey(messageId || "anon", fullText.length);
  const [path, setPath] = useState<string | null>(
    () => getCachedSpillPath(key) ?? null,
  );

  useEffect(() => {
    if (streaming) return;
    if (!fullText.trim()) return;
    const cached = getCachedSpillPath(key);
    if (cached) {
      setPath(cached);
      return;
    }
    if (!api.isTauri()) return;
    let cancelled = false;
    void (async () => {
      try {
        const entry = await api.saveTempAttachment(
          utf8ToBase64(fullText),
          `${safeSpillFileStem(messageId || "reply")}.txt`,
          "text/plain",
        );
        if (cancelled || !entry?.path) return;
        setCachedSpillPath(key, entry.path);
        setPath(entry.path);
      } catch {
        /* keep preview + download fallback */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [streaming, fullText, key, messageId]);

  const downloadLocal = () => {
    const blob = new Blob([fullText], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${safeSpillFileStem(messageId || "reply")}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const fileLabels = useMemo(
    () => ({
      open: tr("attach.open"),
      reveal: revealInOsLabel(tr),
      copyPath: tr("attach.copyPath"),
      openInPanel: tr("resources.openInPanel"),
      openExternal: tr("resources.openExternal"),
      details: tr("attach.details"),
      detailsTitle: tr("attach.detailsTitle"),
      detailsName: tr("attach.detailsName"),
      detailsType: tr("attach.detailsType"),
      detailsPath: tr("attach.detailsPath"),
      detailsResolved: tr("attach.detailsResolved"),
      detailsStatus: tr("attach.detailsStatus"),
      detailsMissing: tr("attach.detailsMissing"),
      detailsOk: tr("attach.detailsOk"),
      detailsClose: tr("attach.detailsClose"),
      typeFile: tr("attach.typeFile"),
      typeUrl: tr("attach.typeUrl"),
      typeDir: tr("attach.typeDir"),
      errNotFound: tr("resources.openErr.notFound"),
      errPathDenied: tr("resources.openErr.pathDenied"),
      errHostOnly: tr("resources.openErr.hostOnly"),
      errNoEditor: tr("resources.openErr.noEditor"),
      errCancelled: tr("resources.openErr.cancelled"),
      errOther: tr("resources.openErr.other"),
      errRevealOther: tr("resources.revealErr.other"),
    }),
    [tr],
  );

  return (
    <div className="lobe-chat-long-reply" data-testid="long-assistant-spill">
      <div className="lobe-chat-reply-length">
        {expanded
          ? tr("chat.longReplyShowingFull")
          : tr("chat.longReplyPreview")}
        {expanded
          ? null
          : streaming
            ? ` · ${tr("chat.longReplySaving")}`
            : path
              ? ` · ${tr("chat.longReplySaved")}`
              : null}
      </div>
      {onToggleExpanded && !streaming ? (
        <button
          type="button"
          className="btn btn--ghost"
          onClick={onToggleExpanded}
        >
          {expanded ? tr("chat.longReplyCollapse") : tr("chat.longReplyShowFull")}
        </button>
      ) : null}
      {path ? (
        <div className="lobe-chat-atts">
          <FilePathCard
            path={path}
            absolutePath={path}
            projectPath={projectPath}
            labels={fileLabels}
            onOpenError={onOpenError}
            onOpenInPanel={(t) => {
              if (t.type === "file" && t.path) {
                onOpenResource?.({
                  type: "file",
                  path: t.path,
                  title: t.title,
                });
              }
            }}
          />
        </div>
      ) : !streaming ? (
        <button
          type="button"
          className="btn btn--ghost"
          onClick={downloadLocal}
        >
          {tr("chat.longReplyDownload")}
        </button>
      ) : null}
    </div>
  );
}
