import { useMemo } from "react";
import { Select } from "@/components/Select";
import type { WallpaperSourceModalProps, WallpaperSourceTab } from "./WallpaperSourceModal";

type Props = {
  t: WallpaperSourceModalProps["t"];
  tab: WallpaperSourceTab;
  query: string;
  sort: "top" | "latest";
  prompt: string;
  aspect: string;
  busy: boolean;
  locked: boolean;
  setQuery: (value: string) => void;
  setSort: (value: "top" | "latest") => void;
  setPrompt: (value: string) => void;
  setAspect: (value: string) => void;
  runXSearch: () => Promise<void>;
  runImagine: () => Promise<void>;
  loadLibrary: () => Promise<void>;
};

export function WallpaperSourceControls({
  t, tab, query, sort, prompt, aspect, busy, locked,
  setQuery, setSort, setPrompt, setAspect, runXSearch, runImagine, loadLibrary,
}: Props) {
  const sortOptions = useMemo(
    () => [
      { value: "top", label: t("settings.wallpaperSource.sortTop") },
      { value: "latest", label: t("settings.wallpaperSource.sortLatest") },
    ],
    [t],
  );

  const aspectOptions = useMemo(
    () => [
      { value: "16:9", label: "16:9" },
      { value: "9:16", label: "9:16" },
      { value: "1:1", label: "1:1" },
      { value: "4:3", label: "4:3" },
      { value: "auto", label: "auto" },
    ],
    [],
  );

  return (
    <>
      {tab === "x" ? (
        <div className="wallpaper-source-form">
          <p className="wallpaper-source-form__hint">
            {t("settings.wallpaperSource.xHint")}
          </p>
          <div className="wallpaper-source-form__row">
            <input
              type="search"
              className="wallpaper-source-form__input"
              value={query}
              placeholder={t("settings.wallpaperSource.xPlaceholder")}
              disabled={locked}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void runXSearch();
                }
              }}
            />
            <Select
              className="wallpaper-source-form__select"
              value={sort}
              options={sortOptions}
              disabled={locked}
              aria-label={t("settings.wallpaperSource.sort")}
              onChange={(v) => setSort(v === "latest" ? "latest" : "top")}
              placement="down"
            />
            <button
              type="button"
              className="btn btn--solid"
              disabled={locked || !query.trim()}
              onClick={() => void runXSearch()}
            >
              {busy
                ? t("settings.wallpaperSource.searching")
                : t("settings.wallpaperSource.search")}
            </button>
          </div>
        </div>
      ) : tab === "imagine" ? (
        <div className="wallpaper-source-form">
          <p className="wallpaper-source-form__hint">
            {t("settings.wallpaperSource.imagineHint")}
          </p>
          <textarea
            className="wallpaper-source-form__textarea"
            value={prompt}
            placeholder={t("settings.wallpaperSource.imaginePlaceholder")}
            disabled={locked}
            rows={3}
            onChange={(e) => setPrompt(e.target.value)}
          />
          <div className="wallpaper-source-form__row">
            <Select
              className="wallpaper-source-form__select"
              value={aspect}
              options={aspectOptions}
              disabled={locked}
              aria-label={t("settings.wallpaperSource.aspect")}
              onChange={setAspect}
              placement="down"
            />
            <button
              type="button"
              className="btn btn--solid"
              disabled={locked || !prompt.trim()}
              onClick={() => void runImagine()}
            >
              {busy
                ? t("settings.wallpaperSource.generating")
                : t("settings.wallpaperSource.generate")}
            </button>
          </div>
        </div>
      ) : (
        <div className="wallpaper-source-form">
          <p className="wallpaper-source-form__hint">
            {t("settings.wallpaperSource.libraryHint")}
          </p>
          <div className="wallpaper-source-form__row">
            <button
              type="button"
              className="btn btn--solid"
              disabled={locked}
              onClick={() => void loadLibrary()}
            >
              {busy
                ? t("settings.wallpaperSource.libraryLoading")
                : t("settings.wallpaperSource.libraryRefresh")}
            </button>
          </div>
        </div>
      )}


    </>
  );
}
