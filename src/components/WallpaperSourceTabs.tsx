import {
  useEffect,
  useRef,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  IconCamera,
  IconFolder,
  IconImagine,
  IconPhotoSearch,
  IconSearch,
  IconWorld,
} from "@/components/icons";
import type { MessageKey } from "@/i18n";
import type { WallpaperSourceTab } from "./WallpaperSourceModal";

type SourceTab = {
  id: WallpaperSourceTab;
  labelKey: MessageKey;
  icon: ReactNode;
};

type SourceTabGroup = {
  id: "discovery" | "create" | "personal";
  tabs: ReadonlyArray<SourceTab>;
};

const SOURCE_TAB_GROUPS: ReadonlyArray<SourceTabGroup> = [
  {
    id: "discovery",
    tabs: [
      {
        id: "x",
        labelKey: "settings.wallpaperFromX",
        icon: <IconSearch size={15} />,
      },
      {
        id: "web",
        labelKey: "settings.wallpaperWeb",
        icon: <IconWorld size={15} />,
      },
      {
        id: "openverse",
        labelKey: "settings.wallpaperOpenverse",
        icon: <IconPhotoSearch size={15} />,
      },
      {
        id: "pexels",
        labelKey: "settings.wallpaperPexels",
        icon: <IconCamera size={15} />,
      },
    ],
  },
  {
    id: "create",
    tabs: [
      {
        id: "imagine",
        labelKey: "settings.wallpaperImagine",
        icon: <IconImagine size={15} />,
      },
    ],
  },
  {
    id: "personal",
    tabs: [
      {
        id: "library",
        labelKey: "settings.wallpaperLibrary",
        icon: <IconFolder size={15} />,
      },
    ],
  },
];

const SOURCE_TABS = SOURCE_TAB_GROUPS.flatMap((group) => group.tabs);

export type WallpaperSourceTabsProps = {
  t: (key: MessageKey) => string;
  value: WallpaperSourceTab;
  disabled: boolean;
  panelId: string;
  onChange: (value: WallpaperSourceTab) => void;
};

export function WallpaperSourceTabs({
  t,
  value,
  disabled,
  panelId,
  onChange,
}: WallpaperSourceTabsProps) {
  const tabRefs = useRef(new Map<WallpaperSourceTab, HTMLButtonElement>());

  useEffect(() => {
    tabRefs.current.get(value)?.scrollIntoView?.({
      block: "nearest",
      inline: "nearest",
    });
  }, [value]);

  const handleKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    current: WallpaperSourceTab,
  ) => {
    if (disabled) return;
    const currentIndex = SOURCE_TABS.findIndex((tab) => tab.id === current);
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % SOURCE_TABS.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex =
        (currentIndex - 1 + SOURCE_TABS.length) % SOURCE_TABS.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = SOURCE_TABS.length - 1;
    }
    if (nextIndex === null) return;
    event.preventDefault();
    const next = SOURCE_TABS[nextIndex];
    if (!next) return;
    tabRefs.current.get(next.id)?.focus();
    onChange(next.id);
  };

  return (
    <div
      className="wallpaper-source-tabs"
      role="tablist"
      aria-orientation="horizontal"
      aria-label={t("settings.wallpaperSource.title")}
    >
      {SOURCE_TAB_GROUPS.map((group) => (
        <div
          key={group.id}
          className={`wallpaper-source-tabs__group wallpaper-source-tabs__group--${group.id}`}
          data-source-group={group.id}
          role="presentation"
        >
          {group.tabs.map((tab) => {
            const active = value === tab.id;
            return (
              <button
                key={tab.id}
                ref={(node) => {
                  if (node) tabRefs.current.set(tab.id, node);
                  else tabRefs.current.delete(tab.id);
                }}
                type="button"
                role="tab"
                tabIndex={active ? 0 : -1}
                id={`wallpaper-source-tab-${tab.id}`}
                aria-controls={panelId}
                aria-selected={active}
                aria-label={t(tab.labelKey)}
                title={t(tab.labelKey)}
                className={
                  "wallpaper-source-tabs__btn" +
                  (active ? " wallpaper-source-tabs__btn--active" : "")
                }
                onClick={() => onChange(tab.id)}
                onKeyDown={(event) => handleKeyDown(event, tab.id)}
                disabled={disabled}
              >
                {tab.icon}
                <span className="wallpaper-source-tabs__label">
                  {t(tab.labelKey)}
                </span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
