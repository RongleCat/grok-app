import { IconExternalLink, IconInfo, IconRefresh } from "@/components/icons";
import type { MessageKey } from "@/i18n";
import type {
  GrokAlbumErrorCode,
  GrokAlbumStatus,
} from "@/lib/grokAlbum";

type Translate = (
  key: MessageKey,
  vars?: Record<string, string | number | undefined | null>,
) => string;

export type GrokAlbumSourcePanelProps = {
  t: Translate;
  status: GrokAlbumStatus;
  busy: boolean;
  syncing: boolean;
  cachedCount: number;
  visibleCount: number;
  errorCode: GrokAlbumErrorCode | null;
  onOpen: () => void;
  onSync: () => void;
  onRefresh: () => void;
};

function statusKey(status: GrokAlbumStatus): MessageKey {
  return `settings.wallpaperSource.grokAlbum.status.${status}` as MessageKey;
}

function errorKey(code: GrokAlbumErrorCode): MessageKey {
  switch (code) {
    case "desktop_only":
      return "settings.wallpaperSource.err.desktopOnly";
    case "timeout":
      return "settings.wallpaperSource.err.timeout";
    case "proxy":
      return "settings.wallpaperSource.err.proxyUnsupported";
    case "window":
    case "bridge":
    case "generic":
    default:
      return "settings.wallpaperSource.err.generic";
  }
}

export function GrokAlbumSourcePanel({
  t,
  status,
  busy,
  syncing,
  cachedCount,
  visibleCount,
  errorCode,
  onOpen,
  onSync,
  onRefresh,
}: GrokAlbumSourcePanelProps) {
  const ready = status === "ready";
  const otherPage = status === "other_page";
  const verification = status === "verification";
  const showStatusLabel = !ready || cachedCount === 0;
  const countLabel =
    cachedCount > 0
      ? t("settings.wallpaperSource.grokAlbum.count", {
          shown: visibleCount,
          cached: cachedCount,
        })
      : null;
  return (
    <div className="wallpaper-source-form wallpaper-grok-album">
      <div className="wallpaper-grok-album__toolbar">
        <div
          className="wallpaper-grok-album__status"
          role="status"
          aria-label={[t(statusKey(status)), countLabel]
            .filter(Boolean)
            .join(" · ")}
        >
          <span className="wallpaper-grok-album__dot" data-status={status} />
          {showStatusLabel ? (
            <span className="wallpaper-grok-album__status-label">
              {t(statusKey(status))}
            </span>
          ) : null}
          {countLabel ? (
            <span className="wallpaper-grok-album__count">
              {countLabel}
            </span>
          ) : null}
          <span
            className="wallpaper-grok-album__privacy-info"
            role="img"
            aria-label={t("settings.wallpaperSource.grokAlbum.privacy")}
            title={t("settings.wallpaperSource.grokAlbum.privacy")}
          >
            <IconInfo size={14} aria-hidden />
          </span>
        </div>
        <div className="wallpaper-source-form__row wallpaper-grok-album__actions">
          {ready ? (
            <>
              <button
                type="button"
                className="btn btn--solid"
                disabled={busy}
                onClick={onSync}
              >
                <IconRefresh size={14} aria-hidden />
                {syncing
                  ? t("settings.wallpaperSource.grokAlbum.syncing")
                  : t("settings.wallpaperSource.grokAlbum.sync")}
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                disabled={busy}
                onClick={onOpen}
              >
                <IconExternalLink size={14} aria-hidden />
                {t("settings.wallpaperSource.grokAlbum.viewSaved")}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn btn--solid"
              disabled={busy}
              onClick={otherPage ? onRefresh : onOpen}
            >
              <IconExternalLink size={14} aria-hidden />
              {status === "sign_in"
                ? t("settings.wallpaperSource.goLogin")
                : verification
                  ? t("settings.wallpaperSource.grokAlbum.viewSaved")
                  : otherPage
                    ? t("settings.wallpaperSource.grokAlbum.backToSaved")
                    : t("settings.wallpaperSource.grokAlbum.open")}
            </button>
          )}
        </div>
      </div>
      {errorCode ? (
        <p className="wallpaper-grok-album__error" role="alert">
          {t(errorKey(errorCode))}
        </p>
      ) : null}
    </div>
  );
}
