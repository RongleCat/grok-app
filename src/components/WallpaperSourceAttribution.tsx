import { IconExternalLink } from "@/components/icons";
import type { MessageKey } from "@/i18n";
import type { WallpaperGalleryItem } from "@/lib/wallpaperSource";

type Translate = (key: MessageKey) => string;

type Props = {
  item: WallpaperGalleryItem;
  t: Translate;
  disabled: boolean;
  onOpen: (url: string) => void;
};

function attributionPart({
  label,
  url,
  disabled,
  onOpen,
  className,
  iconOnly = false,
}: {
  label: string;
  url?: string | null;
  disabled: boolean;
  onOpen: (url: string) => void;
  className: string;
  iconOnly?: boolean;
}) {
  if (!url) {
    return (
      <span className={`wallpaper-attribution__text ${className}`}>
        {label}
      </span>
    );
  }

  return (
    <button
      type="button"
      className={`wallpaper-attribution__link ${className}`}
      disabled={disabled}
      onClick={() => onOpen(url)}
      title={label}
      aria-label={iconOnly ? label : undefined}
    >
      {iconOnly ? <IconExternalLink size={13} aria-hidden /> : label}
    </button>
  );
}

export function WallpaperSourceAttribution({
  item,
  t,
  disabled,
  onOpen,
}: Props) {
  const sourceLabel = item.sourceName?.trim();
  const sourceUrl = item.sourceUrl?.trim();
  const author = item.authorName?.trim();
  const license = item.license?.trim();
  if (!sourceUrl || !sourceLabel) return null;

  const licensedProvider =
    item.source === "openverse" || item.source === "pexels";

  return (
    <div
      className={
        "wallpaper-attribution" +
        (licensedProvider ? " wallpaper-attribution--licensed" : "")
      }
      aria-label={t("settings.wallpaperSource.attribution")}
    >
      {attributionPart({
        label: sourceLabel,
        url: sourceUrl,
        disabled,
        onOpen,
        className: "wallpaper-attribution__source",
        iconOnly: licensedProvider,
      })}
      {author
        ? attributionPart({
            label: author,
            url: item.authorUrl,
            disabled,
            onOpen,
            className: "wallpaper-attribution__author",
          })
        : null}
      {license
        ? attributionPart({
            label: license,
            url: item.licenseUrl,
            disabled,
            onOpen,
            className: "wallpaper-attribution__license",
          })
        : null}
    </div>
  );
}
