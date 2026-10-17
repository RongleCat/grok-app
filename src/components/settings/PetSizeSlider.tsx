/** Settings · Pet — size range + reset (kept out of PetSection: no raw inputs there). */
import { useSettingsModel } from "@/providers/SettingsModelContext";
import { PET_SIZE_MAX, PET_SIZE_MIN, PET_SIZE_STEP } from "@/lib/pet";

export function PetSizeSlider(props: {
  value: number;
  isDefault: boolean;
  onChange: (n: number) => void;
  onReset: () => void;
}) {
  const { t } = useSettingsModel();
  const label = t("settings.pet.size.px", { n: props.value });
  return (
    <div className="pet-size-slider">
      <input
        type="range"
        className="settings-wallpaper__scrim-range"
        min={PET_SIZE_MIN}
        max={PET_SIZE_MAX}
        step={PET_SIZE_STEP}
        value={props.value}
        aria-label={t("settings.pet.size")}
        aria-valuetext={label}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
      <span className="settings-wallpaper__scrim-value" aria-hidden>
        {label}
      </span>
      <button
        type="button"
        className="btn btn--ghost btn--sm pet-size-slider__reset"
        disabled={props.isDefault}
        onClick={props.onReset}
      >
        {t("settings.pet.size.reset")}
      </button>
    </div>
  );
}
