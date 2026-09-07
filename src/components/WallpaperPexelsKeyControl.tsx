import { useEffect, useState, type FormEvent } from "react";
import { IconKey } from "@/components/icons";
import type { MessageKey } from "@/i18n";

type Translate = (key: MessageKey) => string;

export type WallpaperPexelsKeyControlProps = {
  t: Translate;
  hasKey: boolean | null;
  invalid: boolean;
  disabled: boolean;
  onSave: (key: string) => Promise<boolean>;
  onRequestDelete: () => void;
};

export function WallpaperPexelsKeyControl({
  t,
  hasKey,
  invalid,
  disabled,
  onSave,
  onRequestDelete,
}: WallpaperPexelsKeyControlProps) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (hasKey === false || invalid) setEditing(true);
    if (hasKey === true && !invalid) setEditing(false);
  }, [hasKey, invalid]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const key = value.trim();
    if (!key || disabled || saving) return;

    // Do not retain a credential in React state while the Host persists it.
    setValue("");
    setSaving(true);
    try {
      if (await onSave(key)) setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const statusKey: MessageKey = invalid
    ? "settings.wallpaperSource.pexels.keyInvalid"
    : hasKey
      ? "settings.wallpaperSource.pexels.keySaved"
      : "settings.wallpaperSource.pexels.keyRequired";

  return (
    <div className="wallpaper-pexels-key">
      <div className="wallpaper-pexels-key__status" role="status">
        <IconKey size={14} aria-hidden />
        <span>{t(statusKey)}</span>
      </div>

      {hasKey === null ? null : editing ? (
        <form className="wallpaper-pexels-key__form" onSubmit={submit}>
          <input
            type="password"
            className="wallpaper-source-form__input wallpaper-pexels-key__input"
            value={value}
            placeholder={t("settings.wallpaperSource.pexels.keyPlaceholder")}
            aria-label={t("settings.wallpaperSource.pexels.keyPlaceholder")}
            autoComplete="off"
            spellCheck={false}
            disabled={disabled || saving}
            onChange={(event) => setValue(event.target.value)}
          />
          <button
            type="submit"
            className="btn btn--ghost btn--sm"
            disabled={disabled || saving || !value.trim()}
          >
            {t(
              saving
                ? "settings.wallpaperSource.pexels.keySaving"
                : "settings.wallpaperSource.pexels.keySave",
            )}
          </button>
        </form>
      ) : (
        <div className="wallpaper-pexels-key__actions">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={disabled}
            onClick={() => setEditing(true)}
          >
            {t("settings.wallpaperSource.pexels.keyChange")}
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={disabled}
            onClick={onRequestDelete}
          >
            {t("settings.wallpaperSource.pexels.keyDelete")}
          </button>
        </div>
      )}
    </div>
  );
}
