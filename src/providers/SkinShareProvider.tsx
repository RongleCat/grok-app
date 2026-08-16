/**
 * Skin pack preview / apply / pending-import ownership.
 * App.tsx only wraps this provider — no product useState there.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { isDesktopHost } from "@/lib/api";
import {
  listenSkinImportPending,
  skinCatalogDownload,
  skinImportTakePending,
  skinInspectAbort,
  skinPackFetchUrl,
  skinPackInspect,
  skinPresetMaterialize,
  skinPresetSaveFromInspect,
} from "@/lib/api/skin";
import {
  notifySkinLibraryChanged,
  saveActivePresetId,
} from "@/lib/skinActivePreset";
import { acquireAppearanceWrite } from "@/lib/appearanceWriteLock";
import { applySkinPack } from "@/lib/applySkinPack";
import { fileFromAbsolutePath } from "@/lib/wallpaperSource";
import { prepareWallpaperFromFile } from "@/lib/themeSkin";
import {
  onSkinPreviewCancel,
  snapshotBeforeLastApply,
} from "@/lib/skinPresetStore";
import {
  parseSkinPackError,
  type SkinPackErrorCode,
  type SkinPackPreview,
} from "@/lib/skinPack";
import { OFFICIAL_SKIN_CATALOG_URL } from "@/lib/skinCatalog";
import { useThemeShell } from "@/providers/ThemeProvider";
import { SkinImportPreviewModal } from "@/components/settings/SkinImportPreviewModal";

export type SkinShareNotice = {
  kind: "err" | "warn";
  code: SkinPackErrorCode | "unknown_skin" | "will_clear_wallpaper";
};

type PreviewState = {
  preview: SkinPackPreview;
  undoMode: boolean;
  /** Existing library id when applying a saved preset (not undo). */
  libraryId?: string;
};

type SkinShareValue = {
  appearanceBusy: boolean;
  notice: SkinShareNotice | null;
  clearNotice: () => void;
  openFilePreview: (path: string) => Promise<void>;
  openPresetPreview: (id: string, undoMode?: boolean) => Promise<void>;
  openCatalogPreview: (sourceId: string, packId: string) => Promise<void>;
  refreshPending: () => Promise<void>;
};

const Ctx = createContext<SkinShareValue | null>(null);

export function useSkinShare(): SkinShareValue {
  const v = useContext(Ctx);
  if (!v) {
    throw new Error("useSkinShare requires SkinShareProvider");
  }
  return v;
}

export function useSkinShareOptional(): SkinShareValue | null {
  return useContext(Ctx);
}

export function SkinShareProvider({ children }: { children: ReactNode }) {
  const theme = useThemeShell();
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [notice, setNotice] = useState<SkinShareNotice | null>(null);
  const [appearanceBusy, setAppearanceBusy] = useState(false);
  const [progress, setProgress] = useState<{ sent: number; total: number } | null>(
    null,
  );
  const cancelRef = useRef({ cancelled: false });
  const previewRef = useRef(preview);
  previewRef.current = preview;

  const closePreview = useCallback(async () => {
    const cur = previewRef.current;
    setPreview(null);
    setProgress(null);
    if (cur?.preview.id) {
      await skinInspectAbort(cur.preview.id).catch(() => undefined);
    }
  }, []);

  const showPreview = useCallback(
    (next: SkinPackPreview, undoMode = false, libraryId?: string) => {
      setNotice(null);
      setPreview({ preview: next, undoMode, libraryId });
    },
    [],
  );

  const openFilePreview = useCallback(async (path: string) => {
    const p = await skinPackInspect(path);
    showPreview(p);
  }, [showPreview]);

  const openPresetPreview = useCallback(
    async (id: string, undoMode = false) => {
      const p = await skinPresetMaterialize(id);
      showPreview(p, undoMode, undoMode ? undefined : id);
    },
    [showPreview],
  );

  const openCatalogPreview = useCallback(
    async (sourceId: string, packId: string) => {
      const p = await skinCatalogDownload(sourceId, packId);
      showPreview(p);
    },
    [showPreview],
  );

  const refreshPending = useCallback(async () => {
    if (!isDesktopHost()) return;
    const pending = await skinImportTakePending();
    if (!pending) return;
    try {
      if (pending.kind === "file") {
        await openFilePreview(pending.path);
      } else if (pending.kind === "url") {
        const p = await skinPackFetchUrl(pending.href);
        showPreview(p);
      } else {
        if (!OFFICIAL_SKIN_CATALOG_URL) {
          setNotice({ kind: "err", code: "official_unconfigured" });
          return;
        }
        const p = await skinCatalogDownload("official", pending.id);
        showPreview(p);
      }
    } catch (e) {
      const { code } = parseSkinPackError(e);
      setNotice({ kind: "err", code });
    }
  }, [openFilePreview, showPreview]);

  useEffect(() => {
    if (!isDesktopHost()) return;
    void refreshPending();
    let un: (() => void) | undefined;
    void listenSkinImportPending(() => {
      void refreshPending();
    }).then((fn) => {
      un = fn;
    });
    return () => {
      un?.();
    };
  }, [refreshPending]);

  const apply = useCallback(
    async (opts: { keepWallpaper: boolean; saveToLibrary: boolean }) => {
      const cur = previewRef.current;
      if (!cur) return;
      cancelRef.current.cancelled = false;
      setAppearanceBusy(true);
      let savedId: string | null = null;
      try {
        const result = await applySkinPack(
          cur.preview,
          {
            keepWallpaper: opts.keepWallpaper,
            saveToLibrary: opts.saveToLibrary,
            skipUndoSnapshot: cur.undoMode,
          },
          {
            currentLook: () => ({
              skin: theme.skin,
              wallpaperRecord: theme.wallpaperRecord,
              wallpaperScrim: theme.wallpaperScrim,
            }),
            snapshotBeforeLastApply: async () => {
              setProgress({ sent: 0, total: 1 });
              const snap = await snapshotBeforeLastApply({
                name: "Before last apply",
                skin: theme.skin,
                scrim: theme.wallpaperScrim,
                wallpaper: theme.wallpaperRecord,
                onProgress: (sent, total) => setProgress({ sent, total }),
                signal: cancelRef.current,
              });
              setProgress(null);
              return snap;
            },
            fileFromAbsolutePath,
            prepareWallpaperFromFile,
            applyWallpaperChoice: theme.applyWallpaperChoice,
            applyWallpaperAdjustChoice: theme.applyWallpaperAdjustChoice,
            applySkinChoice: theme.applySkinChoice,
            applyWallpaperScrimChoice: theme.applyWallpaperScrimChoice,
            saveFromInspect: async (inspectId) => {
              const entry = await skinPresetSaveFromInspect(inspectId);
              savedId = entry.id;
            },
            inspectAbort: skinInspectAbort,
            acquireWrite: acquireAppearanceWrite,
          },
        );
        if (result.error) {
          if (result.error === "cancelled") {
            await closePreview();
            return;
          }
          setNotice({ kind: "err", code: result.error });
          return;
        }
        if (result.libraryError) {
          setNotice({ kind: "err", code: result.libraryError });
        }
        if (!cur.undoMode) {
          saveActivePresetId(cur.libraryId ?? savedId);
        } else {
          saveActivePresetId(null);
        }
        if (savedId || result.savedToLibrary) {
          notifySkinLibraryChanged();
        }
        setPreview(null);
      } catch (e) {
        const { code } = parseSkinPackError(e);
        setNotice({ kind: "err", code });
      } finally {
        setAppearanceBusy(false);
        setProgress(null);
      }
    },
    [theme, closePreview],
  );

  const saveLibraryOnly = useCallback(async () => {
    const cur = previewRef.current;
    if (!cur || cur.undoMode) return;
    setAppearanceBusy(true);
    try {
      await skinPresetSaveFromInspect(cur.preview.id);
      notifySkinLibraryChanged();
      setPreview(null);
    } catch (e) {
      const { code } = parseSkinPackError(e);
      setNotice({ kind: "err", code });
    } finally {
      setAppearanceBusy(false);
    }
  }, []);

  const value = useMemo<SkinShareValue>(
    () => ({
      appearanceBusy,
      notice,
      clearNotice: () => setNotice(null),
      openFilePreview,
      openPresetPreview,
      openCatalogPreview,
      refreshPending,
    }),
    [
      appearanceBusy,
      notice,
      openFilePreview,
      openPresetPreview,
      openCatalogPreview,
      refreshPending,
    ],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      <SkinImportPreviewModal
        open={!!preview}
        preview={preview?.preview ?? null}
        undoMode={!!preview?.undoMode}
        busy={appearanceBusy}
        progress={progress}
        onCancel={() => {
          const { dismiss } = onSkinPreviewCancel(
            appearanceBusy,
            cancelRef.current,
          );
          if (dismiss) void closePreview();
        }}
        onApply={(opts) => {
          void apply(opts);
        }}
        onSaveLibraryOnly={
          preview &&
          !preview.undoMode &&
          (preview.preview.source === "file" ||
            preview.preview.source === "catalog" ||
            preview.preview.source === "deeplink")
            ? () => {
                void saveLibraryOnly();
              }
            : undefined
        }
      />
    </Ctx.Provider>
  );
}
