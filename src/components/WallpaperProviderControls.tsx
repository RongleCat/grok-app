import { useEffect, useState } from "react";
import * as api from "@/lib/api";
import type { MessageKey } from "@/i18n";
import type { WallpaperRemoteSource } from "@/lib/wallpaperRemoteSearch";
import { WallpaperPexelsKeyControl } from "./WallpaperPexelsKeyControl";
import { WallpaperPexelsKeyDeleteDialog } from "./WallpaperPexelsKeyDeleteDialog";

type Props = {
  source: WallpaperRemoteSource;
  query: string;
  busy: boolean;
  locked: boolean;
  invalidKey: boolean;
  t: (key: MessageKey) => string;
  setQuery: (query: string) => void;
  search: () => Promise<void>;
  cancel: () => Promise<boolean>;
  onSaved: () => void;
};

type CredentialError = "load" | "save" | "delete";

export function WallpaperProviderControls({
  source,
  query,
  busy,
  locked,
  invalidKey,
  t,
  setQuery,
  search,
  cancel,
  onSaved,
}: Props) {
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<CredentialError | null>(null);

  useEffect(() => {
    let active = true;
    setError(null);
    setHasKey(null);
    if (source === "pexels") {
      void api
        .secretsGetMasked()
        .then((result) => {
          if (active) setHasKey(result.hasPexelsKey);
        })
        .catch(() => {
          if (active) {
            setHasKey(false);
            setError("load");
          }
        });
    }
    return () => {
      active = false;
    };
  }, [source]);

  const save = async (key: string) => {
    setSaving(true);
    setError(null);
    try {
      await api.secretsSet({ pexelsApiKey: key });
      setHasKey(Boolean(key));
      onSaved();
      setConfirmDelete(false);
      return true;
    } catch {
      setError(key ? "save" : "delete");
      if (!key) setConfirmDelete(false);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const searchDisabled =
    locked ||
    saving ||
    !query.trim() ||
    (source === "pexels" && hasKey !== true);
  const errorKey = error
    ? (`settings.wallpaperSource.pexels.key${
        error === "load" ? "Load" : error === "save" ? "Save" : "Delete"
      }Failed` as MessageKey)
    : null;

  return (
    <div className="wallpaper-source-form">
      {source === "pexels" ? (
        <WallpaperPexelsKeyControl
          t={t}
          hasKey={hasKey}
          invalid={invalidKey}
          disabled={locked || saving}
          onSave={save}
          onRequestDelete={() => setConfirmDelete(true)}
        />
      ) : null}
      {errorKey ? (
        <p className="wallpaper-source-form__hint" role="alert">
          {t(errorKey)}
        </p>
      ) : null}
      <form
        className="wallpaper-source-form__row wallpaper-source-form__row--search wallpaper-source-form__row--remote"
        onSubmit={(event) => {
          event.preventDefault();
          if (!searchDisabled && !busy) void search();
        }}
      >
        <input
          type="search"
          className="wallpaper-source-form__input"
          value={query}
          aria-label={t("settings.wallpaperSource.search")}
          placeholder={
            source === "web"
              ? t("settings.wallpaperSource.web.placeholder")
              : source === "openverse"
                ? t("settings.wallpaperSource.openverse.placeholder")
              : source === "pexels"
                ? t("settings.wallpaperSource.pexels.placeholder")
                : undefined
          }
          onChange={(event) => setQuery(event.target.value)}
          disabled={locked || saving}
        />
        <button
          type="button"
          className="btn btn--solid"
          disabled={!busy && searchDisabled}
          onClick={() => {
            if (busy) void cancel();
            else void search();
          }}
        >
          {t(
            busy
              ? "settings.wallpaperSource.cancelSearch"
              : "settings.wallpaperSource.search",
          )}
        </button>
      </form>
      <WallpaperPexelsKeyDeleteDialog
        t={t}
        open={confirmDelete}
        deleting={saving}
        onClose={() => {
          if (!saving) setConfirmDelete(false);
        }}
        onConfirm={() => {
          void save("");
        }}
      />
    </div>
  );
}
