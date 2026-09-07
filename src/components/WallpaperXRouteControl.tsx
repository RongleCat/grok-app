import { useEffect, useState } from "react";
import { Select } from "@/components/Select";
import * as api from "@/lib/api";
import type { WallpaperSourceModalProps } from "./WallpaperSourceModal";

type Mode = "cli" | "responses_preview";

export function WallpaperXRouteControl({ t, disabled, onSavingChange }: {
  t: WallpaperSourceModalProps["t"];
  disabled: boolean;
  onSavingChange: (saving: boolean) => void;
}) {
  const [mode, setMode] = useState<Mode>("cli");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    void api.settingsGet().then((settings) => {
      if (active) setMode(settings.wallpaperXSearchMode === "responses_preview" ? "responses_preview" : "cli");
    }).catch(() => { if (active) setError(true); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function save(value: string) {
    const next: Mode = value === "responses_preview" ? "responses_preview" : "cli";
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

  return <div className="wallpaper-source-form">
    <label>{t("settings.wallpaperXSearchMode")}</label>
    <Select value={mode} disabled={disabled || loading}
      aria-label={t("settings.wallpaperXSearchMode")}
      options={[
        { value: "cli", label: t("settings.wallpaperXSearchMode.cli") },
        { value: "responses_preview", label: t("settings.wallpaperXSearchMode.responsesPreview") },
      ]}
      onChange={(value) => { void save(value); }} />
    <p className="wallpaper-source-form__hint">{t("settings.wallpaperXSearchModeDesc")}</p>
    {error ? <p role="alert">{t("settings.wallpaperSource.err.generic")}</p> : null}
  </div>;
}
