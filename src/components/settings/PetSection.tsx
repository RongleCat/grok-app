/**
 * Settings → 宠物 (first-class nav).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useSettingsModel } from "@/providers/SettingsModelContext";
import { UiSwitch } from "./shared";
import { PetMark } from "@/components/pet/PetMark";
import { Select } from "@/components/Select";
import { listen } from "@/lib/api/host";
import type { MessageKey } from "@/i18n";
import {
  PET_BUBBLE_DISMISS_MAX,
  PET_BUBBLE_DISMISS_MIN,
  PET_BUBBLE_SHAPES,
  PET_BUBBLE_STYLES,
  PET_COLORS,
  PET_COLOR_SWATCH,
  PET_SHAPES,
  PET_SIZES,
  isPetColor,
  isPetShape,
  normalizePetBubbleDismissSec,
  normalizePetBubbleShape,
  normalizePetBubbleStyle,
  normalizePetEyeColor,
  normalizePetSize,
  type PetBubbleShape,
  type PetBubbleStyle,
  type PetColor,
  type PetEyeColor,
  type PetShape,
} from "@/lib/pet";
import {
  PET_PREFS_FALLBACK,
  petHide,
  petPrefsGet,
  petPrefsSet,
  petShow,
} from "@/lib/api/pet";
import type { PetPrefs } from "@/lib/api/pet";
import "@/styles/pet.css";

const DEFAULT_PREFS: PetPrefs = { ...PET_PREFS_FALLBACK };

const BUBBLE_SHAPE_KEYS: Record<PetBubbleShape, MessageKey> = {
  round: "settings.pet.bubbleShape.round",
  pill: "settings.pet.bubbleShape.pill",
  card: "settings.pet.bubbleShape.card",
  ticket: "settings.pet.bubbleShape.ticket",
  cloud: "settings.pet.bubbleShape.cloud",
  slash: "settings.pet.bubbleShape.slash",
};

const BUBBLE_STYLE_KEYS: Record<PetBubbleStyle, MessageKey> = {
  ink: "settings.pet.bubbleStyle.ink",
  glass: "settings.pet.bubbleStyle.glass",
  solid: "settings.pet.bubbleStyle.solid",
  paper: "settings.pet.bubbleStyle.paper",
  outline: "settings.pet.bubbleStyle.outline",
  accent: "settings.pet.bubbleStyle.accent",
};

function petWindowOn(p: PetPrefs): boolean {
  return p.enabled && p.visible;
}

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
  const eyeColor: PetEyeColor = normalizePetEyeColor(prefs.eyeColor);
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
        <div className="settings-row" id="settings-anchor-pet-bubbles">
          <div className="settings-row__text">
            <div className="settings-row__label">{t("settings.pet.bubbles")}</div>
            <div className="settings-row__desc">{t("settings.pet.bubblesDesc")}</div>
          </div>
          <UiSwitch
            checked={prefs.bubblesEnabled !== false}
            disabled={busy}
            label={t("settings.pet.bubbles")}
            onChange={(next) => void commit({ ...prefs, bubblesEnabled: next })}
          />
        </div>
        <div className="settings-row" id="settings-anchor-pet-progress">
          <div className="settings-row__text">
            <div className="settings-row__label">{t("settings.pet.progressBar")}</div>
            <div className="settings-row__desc">{t("settings.pet.progressBarDesc")}</div>
          </div>
          <UiSwitch
            checked={prefs.progressBarEnabled === true}
            disabled={busy}
            label={t("settings.pet.progressBar")}
            onChange={(next) => void commit({ ...prefs, progressBarEnabled: next })}
          />
        </div>
        <div className="settings-row" id="settings-anchor-pet-dismiss">
          <div className="settings-row__text">
            <div className="settings-row__label">{t("settings.pet.bubbleDismiss")}</div>
            <div className="settings-row__desc">{t("settings.pet.bubbleDismissDesc")}</div>
          </div>
          <Select
            value={String(normalizePetBubbleDismissSec(prefs.bubbleDismissSec))}
            onChange={(v) =>
              void commit({
                ...prefs,
                bubbleDismissSec: normalizePetBubbleDismissSec(Number(v)),
              })
            }
            options={[5, 10, 15, 20, 30, 45, 60, 90]
              .filter((n) => n >= PET_BUBBLE_DISMISS_MIN && n <= PET_BUBBLE_DISMISS_MAX)
              .map((n) => ({
                value: String(n),
                label: t("settings.pet.bubbleDismiss.seconds", { n }),
              }))}
            aria-label={t("settings.pet.bubbleDismiss")}
            disabled={busy}
          />
        </div>
      </div>

      <div
        className={"settings-card" + rowHighlight("settings-anchor-pet-bubble-look")}
        id="settings-anchor-pet-bubble-look"
      >
        <div className="settings-row settings-row--stack">
          <div className="settings-row__text">
            <div className="settings-row__label">{t("settings.pet.bubbleLook")}</div>
            <div className="settings-row__desc">{t("settings.pet.bubbleLookDesc")}</div>
          </div>
        </div>
        <div className="settings-row settings-row--stack">
          <div className="settings-row__label">{t("settings.pet.bubbleShape")}</div>
          <div className="pet-settings-grid" role="group" aria-label={t("settings.pet.bubbleShape")}>
            {PET_BUBBLE_SHAPES.map((sh) => (
              <button
                key={sh}
                type="button"
                className={
                  "pet-settings-grid__btn" +
                  (normalizePetBubbleShape(prefs.bubbleShape) === sh ? " is-on" : "")
                }
                aria-pressed={normalizePetBubbleShape(prefs.bubbleShape) === sh}
                aria-label={t(BUBBLE_SHAPE_KEYS[sh])}
                disabled={busy}
                onClick={() => void commit({ ...prefs, bubbleShape: sh })}
              >
                <span
                  className={`pet-bubble pet-bubble--${sh} pet-bubble--${normalizePetBubbleStyle(prefs.bubbleStyle)} pet-bubble-preview`}
                />
              </button>
            ))}
          </div>
        </div>
        <div className="settings-row settings-row--stack">
          <div className="settings-row__label">{t("settings.pet.bubbleStyle")}</div>
          <div className="pet-settings-grid" role="group" aria-label={t("settings.pet.bubbleStyle")}>
            {PET_BUBBLE_STYLES.map((st) => (
              <button
                key={st}
                type="button"
                className={
                  "pet-settings-grid__btn" +
                  (normalizePetBubbleStyle(prefs.bubbleStyle) === st ? " is-on" : "")
                }
                aria-pressed={normalizePetBubbleStyle(prefs.bubbleStyle) === st}
                aria-label={t(BUBBLE_STYLE_KEYS[st])}
                disabled={busy}
                onClick={() => void commit({ ...prefs, bubbleStyle: st })}
              >
                <span
                  className={`pet-bubble pet-bubble--${normalizePetBubbleShape(prefs.bubbleShape)} pet-bubble--${st} pet-bubble-preview`}
                />
              </button>
            ))}
          </div>
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
          <PetMark shape={shape} color={color} eyeColor={eyeColor} verb="idle" sizePx={72} />
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
                aria-label={t(`settings.pet.shape.${sh}`)}
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
          id="settings-anchor-pet-eye"
        >
          <div className="settings-row__label">{t("settings.pet.eyeColor")}</div>
          <div className="pet-settings-grid" role="group" aria-label={t("settings.pet.eyeColor")}>
            <button
              type="button"
              className={
                "pet-settings-grid__btn" + (eyeColor === "auto" ? " is-on" : "")
              }
              aria-pressed={eyeColor === "auto"}
              aria-label={t("settings.pet.eyeColor.auto")}
              disabled={busy}
              onClick={() => void commit({ ...prefs, eyeColor: "auto" })}
            >
              <span className="pet-settings-swatch pet-settings-swatch--auto" />
            </button>
            {PET_COLORS.map((c) => (
              <button
                key={`eye-${c}`}
                type="button"
                className={
                  "pet-settings-grid__btn" + (eyeColor === c ? " is-on" : "")
                }
                aria-pressed={eyeColor === c}
                aria-label={PET_COLOR_SWATCH[c].label}
                disabled={busy}
                onClick={() => void commit({ ...prefs, eyeColor: c })}
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
