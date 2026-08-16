import { useEffect, useMemo, useState } from "react";
import { GlassModal } from "@/components/GlassModal";
import { createT, resolveLocale } from "@/i18n";
import {
  OFFICIAL_SKIN_CATALOG_ID,
  type SkinCatalogSource,
} from "@/lib/skinCatalog";
import {
  skinSourcesAdd,
  skinSourcesList,
  skinSourcesRemove,
  skinSourcesSetEnabled,
} from "@/lib/api/skin";
import { parseSkinPackError } from "@/lib/skinPack";
import { UiCheck } from "./shared";

export function SkinSourcesModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const t = useMemo(
    () =>
      createT(
        resolveLocale(
          typeof document !== "undefined" ? document.documentElement.lang : "en",
        ),
      ),
    [],
  );
  const [sources, setSources] = useState<SkinCatalogSource[]>([]);
  const [url, setUrl] = useState("");
  const [confirmHost, setConfirmHost] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const reload = async () => {
    setSources(await skinSourcesList());
  };

  useEffect(() => {
    if (open) void reload();
  }, [open]);

  const tryAdd = () => {
    setErr(null);
    try {
      const u = new URL(url.trim());
      if (u.protocol !== "https:") {
        setErr("url_blocked");
        return;
      }
      setConfirmHost(u.hostname);
    } catch {
      setErr("url_blocked");
    }
  };

  return (
    <>
      <GlassModal
        open={open}
        onClose={onClose}
        title={t("settings.skinCatalog.sourcesTitle")}
        wrapBody
        closeLabel={t("common.close")}
      >
        <div className="skin-sources">
          <ul className="skin-sources__list">
            {sources.map((s) => (
              <li key={s.id} className="skin-sources__row">
                <div className="skin-sources__text">
                  <div className="skin-sources__name">
                    {s.official
                      ? t("settings.skinCatalog.official")
                      : s.label || s.url}
                  </div>
                  <div className="skin-sources__meta">
                    {s.url || t("settings.skinPack.err.official_unconfigured")}
                  </div>
                </div>
                <div className="skin-sources__controls">
                  <UiCheck
                    checked={s.enabled}
                    onChange={() => {
                      void skinSourcesSetEnabled(s.id, !s.enabled).then(reload);
                    }}
                    label={t("settings.skinCatalog.enabled")}
                  />
                  {!s.official ? (
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => void skinSourcesRemove(s.id).then(reload)}
                    >
                      {t("settings.skinPresets.delete")}
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
          <div className="skin-sources__add">
            <label className="skin-sources__add-label" htmlFor="skin-source-url">
              {t("settings.skinCatalog.addUrl")}
            </label>
            <div className="skin-sources__add-row">
              <input
                id="skin-source-url"
                className="settings-input"
                type="url"
                value={url}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                placeholder="https://"
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    tryAdd();
                  }
                }}
              />
              <button
                type="button"
                className="btn btn--solid btn--sm"
                onClick={tryAdd}
              >
                {t("settings.skinCatalog.addSource")}
              </button>
            </div>
          </div>
          {err ? (
            <p className="settings-wallpaper__error" role="alert">
              {t(
                `settings.skinPack.err.${err}` as "settings.skinPack.err.url_blocked",
              )}
            </p>
          ) : null}
        </div>
      </GlassModal>
      <GlassModal
        open={!!confirmHost}
        onClose={() => setConfirmHost(null)}
        title={t("settings.skinCatalog.confirmHostTitle")}
        wrapBody
        footer={
          <>
            <button type="button" className="btn btn--ghost" onClick={() => setConfirmHost(null)}>
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn--solid"
              onClick={() => {
                void skinSourcesAdd(url.trim(), confirmHost ?? "")
                  .then(() => {
                    setUrl("");
                    setConfirmHost(null);
                    return reload();
                  })
                  .catch((e) => {
                    setErr(parseSkinPackError(e).code);
                    setConfirmHost(null);
                  });
              }}
            >
              {t("settings.skinCatalog.confirmHost")}
            </button>
          </>
        }
      >
        <p>{t("settings.skinCatalog.confirmHostBody", { host: confirmHost ?? "" })}</p>
      </GlassModal>
    </>
  );
}

void OFFICIAL_SKIN_CATALOG_ID;
