import { useEffect, useState } from "react";
import { Select } from "@/components/Select";
import * as api from "@/lib/api";
import { normalizeWallpaperXSearchMode } from "@/lib/wallpaperXSearch";
import type { WallpaperSourceModalProps } from "./WallpaperSourceModal";

type Mode = "cli" | "responses_preview";

export function WallpaperXRouteControl({
  t,
  disabled,
  onSavingChange,
}: {
  t: WallpaperSourceModalProps["t"];
  disabled: boolean;
  onSavingChange: (saving: boolean) => void;
}) {
  const [mode, setMode] = useState<Mode>("cli");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    void api
      .settingsGet()
      .then((settings) => {
        if (active) {
          const persisted = normalizeWallpaperXSearchMode(
            settings.wallpaperXSearchMode,
          );
          setMode(persisted === "responses_preview" ? persisted : "cli");
        }
      })
      .catch(() => {
        if (active) setError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function save(value: string) {
    const normalized = normalizeWallpaperXSearchMode(value);
    const next: Mode =
      normalized === "responses_preview" ? normalized : "cli";
    setLoading(true);
    onSavingChange(true);
    setError(false);
    try {
      const current = await api.settingsGet();
      await api.settingsSet({ ...current, wallpaperXSearchMode: next });
      setMode(next);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
      onSavingChange(false);
    }
  }

  return (
    <div className="wallpaper-source-route">
      <Select
        className="wallpaper-source-form__select wallpaper-source-form__select--route"
        value={mode}
        disabled={disabled || loading}
        aria-label={t("settings.wallpaperXSearchMode")}
        title={t("settings.wallpaperXSearchModeDesc")}
        options={[
          { value: "cli", label: t("settings.wallpaperXSearchMode.cli") },
          {
            value: "responses_preview",
            label: t("settings.wallpaperXSearchMode.responsesPreview"),
          },
        ]}
        onChange={(value) => {
          void save(value);
        }}
        placement="down"
      />
      {error ? (
        <span className="wallpaper-source-form__route-error" role="alert">
          {t("settings.wallpaperSource.routeSaveFailed")}
        </span>
      ) : null}
    </div>
  );
}
