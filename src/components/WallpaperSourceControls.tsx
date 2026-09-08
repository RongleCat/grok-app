import { useMemo, type ReactNode } from "react";
import { Select } from "@/components/Select";
import {
  WallpaperImagineControls,
  type WallpaperImagineControlsModel,
} from "@/components/WallpaperImagineControls";
import type { WallpaperSourceModalProps, WallpaperSourceTab } from "./WallpaperSourceModal";

type Props = {
  t: WallpaperSourceModalProps["t"];
  tab: WallpaperSourceTab;
  query: string;
  sort: "top" | "latest";
  imagine: WallpaperImagineControlsModel;
  busy: boolean;
  /** True only while an X search request is in flight (enables Cancel). */
  xBusy?: boolean;
  locked: boolean;
  xRouteControl?: ReactNode;
  setQuery: (value: string) => void;
  setSort: (value: "top" | "latest") => void;
  runXSearch: () => Promise<void>;
  cancelXSearch?: () => Promise<boolean>;
  loadLibrary: () => Promise<void>;
};

export function WallpaperSourceControls({
  t, tab, query, sort, imagine, busy, xBusy = false, locked,
  setQuery, setSort, runXSearch, cancelXSearch, loadLibrary, xRouteControl,
}: Props) {
  const sortOptions = useMemo(
    () => [
      { value: "top", label: t("settings.wallpaperSource.sortTop") },
      { value: "latest", label: t("settings.wallpaperSource.sortLatest") },
    ],
    [t],
  );

  return (
    <>
      {tab === "x" ? (
        <div className="wallpaper-source-form">
          <div className="wallpaper-source-form__row wallpaper-source-form__row--search wallpaper-source-form__row--x">
            <input
              type="search"
              className="wallpaper-source-form__input"
              value={query}
              aria-label={t("settings.wallpaperSource.xPlaceholder")}
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
            {xRouteControl}
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
              disabled={!xBusy && (locked || !query.trim())}
              onClick={() => {
                if (xBusy) void cancelXSearch?.();
                else void runXSearch();
              }}
            >
              {xBusy
                ? t("settings.wallpaperSource.cancelSearch")
                : busy
                  ? t("settings.wallpaperSource.searching")
                  : t("settings.wallpaperSource.search")}
            </button>
          </div>
        </div>
      ) : tab === "imagine" ? (
        <WallpaperImagineControls t={t} locked={locked} model={imagine} />
      ) : (
        <div className="wallpaper-source-form">
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
