/**
 * Settings → Appearance → Theme: local presets + import/export.
 * Hidden when not the desktop host.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { isDesktopHost } from "@/lib/api";
import {
  skinPackExport,
  skinPickOpen,
  skinPickSave,
  skinPresetDelete,
  skinPresetExport,
  skinPresetList,
  skinPresetRename,
  skinPresetReplaceFromUpload,
  skinPresetSaveFromUpload,
  type SkinPresetListItem,
} from "@/lib/api/skin";
import {
  loadActivePresetId,
  notifySkinLibraryChanged,
  resolveActivePresetId,
  saveActivePresetId,
  subscribeSkinLibraryChanged,
} from "@/lib/skinActivePreset";
import { officialCatalogConfigured } from "@/lib/skinCatalog";
import { exportFileName, parseSkinPackError, type SkinPackErrorCode } from "@/lib/skinPack";
import {
  currentLookManifest,
  uploadCurrentWallpaper,
} from "@/lib/skinPresetStore";
import { subscribeAppearanceWriteBusy } from "@/lib/appearanceWriteLock";
import { useThemeShell } from "@/providers/ThemeProvider";
import { useSkinShare } from "@/providers/SkinShareProvider";
import { useSettingsModel } from "@/providers/SettingsModelContext";
import { GlassModal } from "@/components/GlassModal";
import { SkinCatalogModal } from "./SkinCatalogModal";
import { SkinSourcesModal } from "./SkinSourcesModal";

export function SkinPresetsCard() {
  const desktop = isDesktopHost();
  const theme = useThemeShell();
  const share = useSkinShare();
  const s = useSettingsModel() as { t: (k: string, v?: Record<string, string | number>) => string };
  const t = s.t;
  const [presets, setPresets] = useState<SkinPresetListItem[]>([]);
  const [usage, setUsage] = useState({ bytes: 0, budget: 0, hasUndo: false });
  const [busy, setBusy] = useState(false);
  const [writeBusy, setWriteBusy] = useState(false);
  const [nameOpen, setNameOpen] = useState<"save" | "export" | "rename" | null>(null);
  const [nameValue, setNameValue] = useState("");
  const [renameId, setRenameId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [updateId, setUpdateId] = useState<string | null>(null);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [actionError, setActionError] = useState<SkinPackErrorCode | null>(null);
  const [actionWarn, setActionWarn] = useState<"ffmpeg_unavailable" | null>(null);

  useEffect(() => subscribeAppearanceWriteBusy(setWriteBusy), []);

  const reload = useCallback(async () => {
    if (!desktop) return;
    const r = await skinPresetList();
    setPresets(r.presets);
    setUsage(r.usage);
  }, [desktop]);

  useEffect(() => {
    void reload();
    return subscribeSkinLibraryChanged(() => {
      void reload();
    });
  }, [reload]);

  const activeId = resolveActivePresetId(loadActivePresetId(), presets, {
    skin: theme.skin,
    wallpaperRecord: theme.wallpaperRecord,
    wallpaperScrim: theme.wallpaperScrim,
  });

  const locked = busy || writeBusy || share.appearanceBusy;
  const showOfficialBrowse = officialCatalogConfigured();

  const runNamed = useCallback(async () => {
    const name = nameValue.trim();
    if (!name) return;
    setBusy(true);
    setActionError(null);
    setActionWarn(null);
    try {
      if (nameOpen === "save") {
        const manifest = currentLookManifest({
          name,
          skin: theme.skin,
          scrim: theme.wallpaperScrim,
          wallpaper: theme.wallpaperRecord,
        });
        let stagingId: string | null = null;
        if (theme.wallpaperRecord?.blob) {
          stagingId = await uploadCurrentWallpaper({
            blob: theme.wallpaperRecord.blob,
          });
        }
        const entry = await skinPresetSaveFromUpload(stagingId ?? "", manifest);
        saveActivePresetId(entry.id);
        notifySkinLibraryChanged();
        await reload();
      } else if (nameOpen === "export") {
        const dest = await skinPickSave(exportFileName(name));
        if (!dest) return;
        const manifest = currentLookManifest({
          name,
          skin: theme.skin,
          scrim: theme.wallpaperScrim,
          wallpaper: theme.wallpaperRecord,
        });
        let stagingId: string | null = null;
        if (theme.wallpaperRecord?.blob) {
          stagingId = await uploadCurrentWallpaper({
            blob: theme.wallpaperRecord.blob,
          });
        }
        const exported = await skinPackExport(dest, stagingId, manifest);
        if (exported.warning === "ffmpeg_unavailable") {
          setActionWarn("ffmpeg_unavailable");
        }
      } else if (nameOpen === "rename" && renameId) {
        await skinPresetRename(renameId, name);
        notifySkinLibraryChanged();
        await reload();
      }
    } catch (e) {
      setActionError(parseSkinPackError(e).code);
    } finally {
      setBusy(false);
      setNameOpen(null);
      setRenameId(null);
    }
  }, [nameOpen, nameValue, reload, renameId, theme]);

  const runUpdate = useCallback(async () => {
    if (!updateId) return;
    setBusy(true);
    setActionError(null);
    setActionWarn(null);
    try {
      const target = presets.find((p) => p.id === updateId);
      const manifest = currentLookManifest({
        name: target?.name ?? "skin",
        skin: theme.skin,
        scrim: theme.wallpaperScrim,
        wallpaper: theme.wallpaperRecord,
      });
      let stagingId = "";
      if (theme.wallpaperRecord?.blob) {
        stagingId = await uploadCurrentWallpaper({
          blob: theme.wallpaperRecord.blob,
        });
      }
      const entry = await skinPresetReplaceFromUpload(
        updateId,
        stagingId,
        manifest,
      );
      saveActivePresetId(entry.id);
      notifySkinLibraryChanged();
      await reload();
    } catch (e) {
      setActionError(parseSkinPackError(e).code);
    } finally {
      setBusy(false);
      setUpdateId(null);
    }
  }, [presets, reload, theme, updateId]);

  if (!desktop) return null;

  return (
    <div
      className="settings-card settings-card--appearance-col"
      id="settings-anchor-skin-presets"
    >
      <div className="settings-row settings-row--stack">
        <div className="settings-row__text">
          <div className="settings-label">{t("settings.skinPresets.title")}</div>
          <p className="settings-desc">{t("settings.skinPresets.desc")}</p>
        </div>
        <div className="skin-presets__actions">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={locked}
            onClick={() => {
              setNameValue("");
              setNameOpen("save");
            }}
          >
            {t("settings.skinPresets.saveCurrent")}
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={locked}
            onClick={() => {
              void (async () => {
                const path = await skinPickOpen();
                if (path) await share.openFilePreview(path);
              })();
            }}
          >
            {t("settings.skinPresets.importFile")}
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={locked}
            onClick={() => {
              setNameValue("");
              setNameOpen("export");
            }}
          >
            {t("settings.skinPresets.exportCurrent")}
          </button>
          {showOfficialBrowse ? (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              id="settings-anchor-skin-catalog"
              disabled={locked}
              onClick={() => setCatalogOpen(true)}
            >
              {t("settings.skinCatalog.browse")}
            </button>
          ) : (
            <span id="settings-anchor-skin-catalog" className="sr-only">
              {t("settings.skinCatalog.browse")}
            </span>
          )}
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            id="settings-anchor-skin-sources"
            disabled={locked}
            onClick={() => setSourcesOpen(true)}
          >
            {t("settings.skinCatalog.manageSources")}
          </button>
          {usage.hasUndo ? (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              disabled={locked}
              onClick={() => void share.openPresetPreview("before-last-apply", true)}
            >
              {t("settings.skinPresets.undoLast")}
            </button>
          ) : null}
        </div>
        {presets.length === 0 ? (
          <p className="settings-desc">{t("settings.skinPresets.empty")}</p>
        ) : (
          <ul className="skin-presets__list">
            {presets.map((p) => (
              <li
                key={p.id}
                className={
                  "skin-presets__row" + (p.id === activeId ? " is-current" : "")
                }
              >
                <div>
                  <div className="skin-presets__name">
                    {p.name}
                    {p.id === activeId ? (
                      <span className="skin-presets__current">
                        {t("settings.skinPresets.current")}
                      </span>
                    ) : null}
                  </div>
                  <div className="skin-presets__meta">
                    {p.skin}
                    {p.hasWallpaper ? ` · ${p.kind ?? "image"}` : ""}
                    {p.bytes ? ` · ${Math.round(p.bytes / 1024)} KB` : ""}
                  </div>
                </div>
                <div className="skin-presets__row-actions">
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    disabled={locked}
                    onClick={() => void share.openPresetPreview(p.id)}
                  >
                    {t("settings.skinPresets.apply")}
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    disabled={locked}
                    onClick={() => setUpdateId(p.id)}
                  >
                    {t("settings.skinPresets.updateCurrent")}
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    disabled={locked}
                    onClick={() => {
                      setRenameId(p.id);
                      setNameValue(p.name);
                      setNameOpen("rename");
                    }}
                  >
                    {t("settings.skinPresets.rename")}
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    disabled={locked}
                    onClick={() => {
                      void (async () => {
                        setActionError(null);
                        setActionWarn(null);
                        try {
                          const dest = await skinPickSave(exportFileName(p.name));
                          if (!dest) return;
                          const exported = await skinPresetExport(p.id, dest);
                          if (exported.warning === "ffmpeg_unavailable") {
                            setActionWarn("ffmpeg_unavailable");
                          }
                        } catch (e) {
                          setActionError(parseSkinPackError(e).code);
                        }
                      })();
                    }}
                  >
                    {t("settings.skinPresets.export")}
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    disabled={locked}
                    onClick={() => setDeleteId(p.id)}
                  >
                    {t("settings.skinPresets.delete")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {actionError || share.notice?.kind === "err" ? (
          <p className="settings-wallpaper__error" role="alert">
            {t(
              `settings.skinPack.err.${actionError ?? share.notice!.code}` as "settings.skinPack.err.busy",
            )}
          </p>
        ) : actionWarn ? (
          <p className="settings-desc" role="status">
            {t("settings.skinPack.warn.ffmpeg_unavailable")}
          </p>
        ) : share.notice?.kind === "warn" ? (
          <p className="settings-desc" role="status">
            {t(
              `settings.skinPack.warn.${share.notice.code}` as "settings.skinPack.warn.unknown_skin",
            )}
          </p>
        ) : null}
      </div>

      <GlassModal
        open={!!nameOpen}
        onClose={() => setNameOpen(null)}
        title={
          nameOpen === "rename"
            ? t("settings.skinPresets.renameTitle")
            : t("settings.skinPresets.nameTitle")
        }
        wrapBody
        footer={
          <>
            <button type="button" className="btn btn--ghost" onClick={() => setNameOpen(null)}>
              {t("common.cancel")}
            </button>
            <button type="button" className="btn btn--solid" disabled={busy} onClick={() => void runNamed()}>
              {t("common.save")}
            </button>
          </>
        }
      >
        <label className="skin-sources__add">
          <span className="skin-sources__add-label">
            {t("settings.skinPresets.nameLabel")}
          </span>
          <input
            className="settings-input"
            value={nameValue}
            maxLength={80}
            onChange={(e) => setNameValue(e.target.value)}
          />
        </label>
      </GlassModal>

      <GlassModal
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        title={t("settings.skinPresets.deleteTitle")}
        wrapBody
        footer={
          <>
            <button type="button" className="btn btn--ghost" onClick={() => setDeleteId(null)}>
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn--solid"
              onClick={() => {
                if (!deleteId) return;
                void skinPresetDelete(deleteId).then(() => {
                  if (loadActivePresetId() === deleteId) {
                    saveActivePresetId(null);
                  }
                  setDeleteId(null);
                  notifySkinLibraryChanged();
                  void reload();
                });
              }}
            >
              {t("settings.skinPresets.delete")}
            </button>
          </>
        }
      >
        <p>{t("settings.skinPresets.deleteConfirm")}</p>
      </GlassModal>

      <GlassModal
        open={!!updateId}
        onClose={() => setUpdateId(null)}
        title={t("settings.skinPresets.updateTitle")}
        wrapBody
        footer={
          <>
            <button type="button" className="btn btn--ghost" onClick={() => setUpdateId(null)}>
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn--solid"
              disabled={busy}
              onClick={() => void runUpdate()}
            >
              {t("settings.skinPresets.updateCurrent")}
            </button>
          </>
        }
      >
        <p>{t("settings.skinPresets.updateConfirm")}</p>
      </GlassModal>

      <SkinCatalogModal open={catalogOpen} onClose={() => setCatalogOpen(false)} />
      <SkinSourcesModal open={sourcesOpen} onClose={() => setSourcesOpen(false)} />
    </div>
  );
}

void useMemo;
