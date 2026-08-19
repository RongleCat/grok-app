/**
 * Settings → 宠物 (first-class nav).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { MessageKey } from "@/i18n";
import { useSettingsModel } from "@/providers/SettingsModelContext";
import { UiSwitch } from "./shared";
import { PetMark } from "@/components/pet/PetMark";
import { Select } from "@/components/Select";
import { listen } from "@/lib/api/host";
import {
  PET_COLORS,
  PET_COLOR_SWATCH,
  PET_EYE_COLORS,
  PET_EYE_INK,
  PET_SHAPES,
  PET_SIZES,
  isPetColor,
  isPetEyeColor,
  isPetShape,
  normalizePetEyeColor,
  normalizePetSize,
  type PetColor,
  type PetEyeColor,
  type PetShape,
} from "@/lib/pet";
import {
  petHide,
  petPrefsGet,
  petPrefsSet,
  petShow,
} from "@/lib/api/pet";
import type { PetPrefs } from "@/lib/api/pet";
import "@/styles/pet.css";

const DEFAULT_PREFS: PetPrefs = {
  enabled: false,
  visible: false,
  shape: "hex",
  color: "green",
  sizePx: 128,
  eyeColor: "auto",
};

function petWindowOn(p: PetPrefs): boolean {
  return p.enabled && p.visible;
}

const EYE_COLOR_LABEL: Record<PetEyeColor, MessageKey> = {
  auto: "settings.pet.eyeColor.auto",
  white: "settings.pet.eyeColor.white",
  cream: "settings.pet.eyeColor.cream",
  gold: "settings.pet.eyeColor.gold",
  orange: "settings.pet.eyeColor.orange",
  red: "settings.pet.eyeColor.red",
  green: "settings.pet.eyeColor.green",
  cyan: "settings.pet.eyeColor.cyan",
  blue: "settings.pet.eyeColor.blue",
  violet: "settings.pet.eyeColor.violet",
  black: "settings.pet.eyeColor.black",
};

export function PetSection() {
  const s = useSettingsModel();
  const t = s.t;
  const rowHighlight = s.rowHighlight ?? ((_id: string) => "");
  const [prefs, setPrefs] = useState<PetPrefs>(DEFAULT_PREFS);
  const [busy, setBusy] = useState(false);
  const toggleGen = useRef(0);

  useEffect(() => {
    let gone = false;
    let unlisten: (() => void) | undefined;
    void petPrefsGet().then((p) => {
      if (!gone) setPrefs(p);
    });
    void listen<PetPrefs>("pet://prefs", (p) => {
      if (!gone && p) setPrefs(p);
    }).then((u) => {
      if (gone) u();
      else unlisten = u;
    });
    return () => {
      gone = true;
      unlisten?.();
    };
  }, []);

  const commit = useCallback(async (next: PetPrefs) => {
    setPrefs(next);
    setBusy(true);
    try {
      const saved = await petPrefsSet(next);
      setPrefs(saved);
    } finally {
      setBusy(false);
    }
  }, []);

  const onToggleWindow = useCallback(async (next: boolean) => {
    const gen = ++toggleGen.current;
    setPrefs((p) => ({ ...p, enabled: next ? true : p.enabled, visible: next }));
    setBusy(true);
    try {
      const saved = next ? await petShow() : await petHide();
      if (gen !== toggleGen.current) return;
      setPrefs(saved);
    } catch {
      if (gen !== toggleGen.current) return;
      try {
        setPrefs(await petPrefsGet());
      } catch {
        /* keep optimistic state */
      }
    } finally {
      if (gen === toggleGen.current) setBusy(false);
    }
  }, []);

  const shown = petWindowOn(prefs);
  const shape: PetShape = isPetShape(prefs.shape) ? prefs.shape : "hex";
  const color: PetColor = isPetColor(prefs.color) ? prefs.color : "green";
  const eyeColor: PetEyeColor = isPetEyeColor(prefs.eyeColor)
    ? prefs.eyeColor
    : "auto";
  const sizePx = normalizePetSize(prefs.sizePx);

  return (
    <>
      <div
        className={"settings-card" + rowHighlight("settings-anchor-pet")}
        id="settings-anchor-pet"
      >
        <div className="settings-row settings-row--stack">
          <div className="settings-row__text">
            <div className="settings-row__label">{t("settings.nav.pet")}</div>
            <div className="settings-row__desc">{t("settings.pet.desc")}</div>
          </div>
        </div>
        <div className="settings-row">
          <div className="settings-row__text">
            <div className="settings-row__label">{t("settings.pet.enabled")}</div>
            <div className="settings-row__desc">{t("settings.pet.enabledDesc")}</div>
          </div>
          <UiSwitch
            checked={shown}
            disabled={busy}
            label={t("settings.pet.enabled")}
            onChange={(next) => void onToggleWindow(next)}
          />
        </div>
      </div>

      <div
        className={"settings-card" + rowHighlight("settings-anchor-pet-identity")}
        id="settings-anchor-pet-identity"
      >
        <div className="settings-row settings-row--stack">
          <div className="settings-row__text">
            <div className="settings-row__label">{t("settings.pet.identity")}</div>
            <div className="settings-row__desc">{t("settings.pet.identityDesc")}</div>
          </div>
          <PetMark
            shape={shape}
            color={color}
            eyeColor={eyeColor}
            verb="idle"
            sizePx={72}
          />
        </div>
        <div className="settings-row settings-row--stack">
          <div className="settings-row__label">{t("settings.pet.shape")}</div>
          <div className="pet-settings-grid" role="group" aria-label={t("settings.pet.shape")}>
            {PET_SHAPES.map((sh) => (
              <button
                key={sh}
                type="button"
                className={
                  "pet-settings-grid__btn" + (shape === sh ? " is-on" : "")
                }
                aria-pressed={shape === sh}
                aria-label={sh}
                disabled={busy}
                onClick={() => void commit({ ...prefs, shape: sh })}
              >
                <PetMark
                  shape={sh}
                  color={color}
                  eyeColor={eyeColor}
                  verb="idle"
                  sizePx={28}
                  paused
                />
              </button>
            ))}
          </div>
        </div>
        <div className="settings-row settings-row--stack">
          <div className="settings-row__label">{t("settings.pet.color")}</div>
          <div className="pet-settings-grid" role="group" aria-label={t("settings.pet.color")}>
            {PET_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={
                  "pet-settings-grid__btn" + (color === c ? " is-on" : "")
                }
                aria-pressed={color === c}
                aria-label={PET_COLOR_SWATCH[c].label}
                disabled={busy}
                onClick={() => void commit({ ...prefs, color: c })}
              >
                <span
                  className={
                    "pet-settings-swatch" +
                    (c === "white" ? " pet-settings-swatch--light" : "")
                  }
                  style={{ background: PET_COLOR_SWATCH[c].value }}
                />
              </button>
            ))}
          </div>
        </div>
        <div
          className="settings-row settings-row--stack"
          id="settings-anchor-pet-eyes"
        >
          <div className="settings-row__label">{t("settings.pet.eyeColor")}</div>
          <div
            className="pet-settings-grid"
            role="group"
            aria-label={t("settings.pet.eyeColor")}
          >
            {PET_EYE_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={
                  "pet-settings-grid__btn" + (eyeColor === c ? " is-on" : "")
                }
                aria-pressed={eyeColor === c}
                aria-label={t(EYE_COLOR_LABEL[c])}
                disabled={busy}
                onClick={() =>
                  void commit({
                    ...prefs,
                    eyeColor: normalizePetEyeColor(c),
                  })
                }
              >
                <span
                  className={
                    "pet-settings-swatch" +
                    (c === "auto" ? " pet-settings-swatch--auto" : "")
                  }
                  style={
                    c === "auto"
                      ? undefined
                      : { background: PET_EYE_INK[c] }
                  }
                />
              </button>
            ))}
          </div>
        </div>
      </div>

      <div
        className={"settings-card" + rowHighlight("settings-anchor-pet-size")}
        id="settings-anchor-pet-size"
      >
        <div className="settings-row">
          <div className="settings-row__text">
            <div className="settings-row__label">{t("settings.pet.size")}</div>
            <div className="settings-row__desc">{t("settings.pet.sizeDesc")}</div>
          </div>
          <Select
            value={String(sizePx)}
            onChange={(v) =>
              void commit({ ...prefs, sizePx: normalizePetSize(Number(v)) })
            }
            options={PET_SIZES.map((n) => ({
              value: String(n),
              label:
                n === 96
                  ? t("settings.pet.size.sm")
                  : n === 160
                    ? t("settings.pet.size.lg")
                    : t("settings.pet.size.md"),
            }))}
            aria-label={t("settings.pet.size")}
          />
        </div>
      </div>
    </>
  );
}
