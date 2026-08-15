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
        <ul className="skin-presets__list">
          {sources.map((s) => (
            <li key={s.id} className="skin-presets__row">
              <div>
                <div className="skin-presets__name">
                  {s.official ? t("settings.skinCatalog.official") : s.label || s.url}
                </div>
                <div className="skin-presets__meta">{s.url || t("settings.skinPack.err.official_unconfigured")}</div>
              </div>
              <label className="skin-preview__check">
                <input
                  type="checkbox"
                  checked={s.enabled}
                  onChange={(e) => {
                    void skinSourcesSetEnabled(s.id, e.target.checked).then(reload);
                  }}
                />
                {t("settings.skinCatalog.enabled")}
              </label>
              {!s.official ? (
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => void skinSourcesRemove(s.id).then(reload)}
                >
                  {t("settings.skinPresets.delete")}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
        <label className="skin-preview__check">
          {t("settings.skinCatalog.addUrl")}
          <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} />
        </label>
        <button type="button" className="btn btn--solid btn--sm" onClick={tryAdd}>
          {t("settings.skinCatalog.addSource")}
        </button>
        {err ? (
          <p className="settings-wallpaper__error" role="alert">
            {t(`settings.skinPack.err.${err}` as "settings.skinPack.err.url_blocked")}
          </p>
        ) : null}
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
