import { useEffect, useMemo, useState } from "react";
import { GlassModal } from "@/components/GlassModal";
import { createT, resolveLocale } from "@/i18n";
import {
  officialCatalogConfigured,
  OFFICIAL_SKIN_CATALOG_ID,
  type CatalogPack,
} from "@/lib/skinCatalog";
import { skinCatalogFetch, skinSourcesList } from "@/lib/api/skin";
import { parseSkinPackError } from "@/lib/skinPack";
import { useSkinShare } from "@/providers/SkinShareProvider";

export function SkinCatalogModal({
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
  const share = useSkinShare();
  const [packs, setPacks] = useState<Array<CatalogPack & { sourceId: string }> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      setError(null);
      setPacks(null);
      try {
        const sources = await skinSourcesList();
        const enabled = sources.filter((s) => s.enabled && (s.official ? officialCatalogConfigured() : true));
        if (enabled.length === 0) {
          setError(
            officialCatalogConfigured()
              ? "source_disabled"
              : "official_unconfigured",
          );
          setPacks([]);
          return;
        }
        const all: (CatalogPack & { sourceId: string })[] = [];
        for (const src of enabled) {
          if (src.id === OFFICIAL_SKIN_CATALOG_ID && !officialCatalogConfigured()) {
            continue;
          }
          const rows = await skinCatalogFetch(src.id, false);
          all.push(...rows.map((p) => ({ ...p, sourceId: src.id })));
        }
        if (!cancelled) setPacks(all);
      } catch (e) {
        if (!cancelled) {
          setError(parseSkinPackError(e).code);
          setPacks([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const shown = (packs ?? []).filter((p) => {
    const q = filter.trim().toLowerCase();
    if (!q) return true;
    return (
      p.name.toLowerCase().includes(q) ||
      p.tags.some((x) => x.toLowerCase().includes(q))
    );
  });

  return (
    <GlassModal
      open={open}
      onClose={onClose}
      title={t("settings.skinCatalog.title")}
      size="lg"
      wrapBody
      closeLabel={t("common.close")}
    >
      <div className="skin-sources">
      <input
        className="settings-input"
        value={filter}
        placeholder={t("settings.skinCatalog.filter")}
        onChange={(e) => setFilter(e.target.value)}
      />
      {packs === null ? (
        <p className="settings-desc">{t("settings.skinCatalog.loading")}</p>
      ) : error === "official_unconfigured" ? (
        <p className="settings-desc">{t("settings.skinPack.err.official_unconfigured")}</p>
      ) : error === "source_disabled" ? (
        <p className="settings-desc">{t("settings.skinPack.err.source_disabled")}</p>
      ) : packs.length === 0 ? (
        <p className="settings-desc">{t("settings.skinCatalog.empty")}</p>
      ) : shown.length === 0 ? (
        <p className="settings-desc">{t("settings.skinCatalog.filterEmpty")}</p>
      ) : (
        <ul className="skin-presets__list">
          {shown.map((p) => (
            <li key={p.id} className="skin-presets__row">
              <div>
                <div className="skin-presets__name">{p.name}</div>
                <div className="skin-presets__meta">
                  {p.author}
                  {p.hasWallpaper ? " · wallpaper" : ""}
                </div>
              </div>
              <button
                type="button"
                className="btn btn--solid btn--sm"
                onClick={() => {
                  void share
                    .openCatalogPreview(p.sourceId, p.id)
                    .catch(() => undefined);
                  onClose();
                }}
              >
                {t("settings.skinCatalog.download")}
              </button>
            </li>
          ))}
        </ul>
      )}
      </div>
    </GlassModal>
  );
}
