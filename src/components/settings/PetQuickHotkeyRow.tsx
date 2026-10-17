/** Settings · Pet — global hotkey that opens the pet quick bar. */
import { useEffect, useState } from "react";
import { useSettingsModel } from "@/providers/SettingsModelContext";
import { SettingsLabelWithTip } from "./shared";
import {
  PET_QUICK_DEFAULT_HOTKEY,
  normalizePetHotkey,
  petQuickHotkeyGet,
  petQuickHotkeySet,
  petQuickShow,
} from "@/lib/api/petQuick";

export function PetQuickHotkeyRow() {
  const { t } = useSettingsModel();
  const [saved, setSaved] = useState(PET_QUICK_DEFAULT_HOTKEY);
  const [draft, setDraft] = useState(PET_QUICK_DEFAULT_HOTKEY);
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");

  useEffect(() => {
    void petQuickHotkeyGet()
      .then((k) => {
        setSaved(k);
        setDraft(k);
      })
      .catch(() => {});
  }, []);

  const apply = async (raw: string) => {
    const next = normalizePetHotkey(raw);
    try {
      const stored = await petQuickHotkeySet(next);
      setSaved(stored);
      setDraft(stored);
      setStatus("saved");
    } catch {
      setDraft(saved);
      setStatus("error");
    }
  };

  return (
    <div className="pet-look__toolbar-item" id="settings-anchor-pet-hotkey">
      <SettingsLabelWithTip
        label={t("settings.pet.quickHotkey")}
        tip={t("settings.pet.quickHotkeyDesc")}
      />
      <div className="pet-size-slider">
        <input
          type="text"
          className="settings-input pet-hotkey__input"
          value={draft}
          spellCheck={false}
          placeholder={t("settings.pet.quickHotkeyOff")}
          aria-label={t("settings.pet.quickHotkey")}
          onChange={(e) => {
            setDraft(e.target.value);
            setStatus("idle");
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") void apply(draft);
          }}
        />
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          disabled={normalizePetHotkey(draft) === saved}
          onClick={() => void apply(draft)}
        >
          {t("settings.pet.quickHotkeySave")}
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          disabled={saved === PET_QUICK_DEFAULT_HOTKEY}
          onClick={() => void apply(PET_QUICK_DEFAULT_HOTKEY)}
        >
          {t("settings.pet.size.reset")}
        </button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => void petQuickShow()}>
          {t("settings.pet.quickOpen")}
        </button>
      </div>
      {status === "error" ? (
        <div className="pet-hotkey__status pet-hotkey__status--error" role="alert">
          {t("settings.pet.quickHotkeyError")}
        </div>
      ) : status === "saved" ? (
        <div className="pet-hotkey__status" role="status">
          {saved ? t("settings.pet.quickHotkeySaved", { key: saved }) : t("settings.pet.quickHotkeyDisabled")}
        </div>
      ) : null}
    </div>
  );
}
