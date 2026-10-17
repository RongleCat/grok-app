/**
 * Settings → 宠物 (first-class nav).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useSettingsModel } from "@/providers/SettingsModelContext";
import { SettingsLabelWithTip, SettingsTabStrip, UiSwitch } from "./shared";
import { PetMark } from "@/components/pet/PetMark";
import { Select } from "@/components/Select";
import { PetQuickHotkeyRow } from "./PetQuickHotkeyRow";
import { PetSizeSlider } from "./PetSizeSlider";
import { listen } from "@/lib/api/host";
import type { MessageKey } from "@/i18n";
import {
  PET_BUBBLE_DISMISS_MAX,
  PET_BUBBLE_DISMISS_MIN,
  PET_BUBBLE_SHAPES,
  PET_BUBBLE_STYLES,
  PET_COLORS,
  PET_COLOR_SWATCH,
  PET_EXPRESSIONS,
  PET_PICKER_SHAPES,
  PET_SIZE_DEFAULT,
  isPetColor,
  isPetShape,
  normalizePetBubbleDismissSec,
  normalizePetExpression,
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
  const activeTab = s.activeTab;
  const setSectionTab = s.setSectionTab;
  const sectionNav = s.sectionNav;
  const title = s.title;
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

  // Slider drags update a local draft; the overlay resizes once the thumb settles.
  const [sizeDraft, setSizeDraft] = useState<number | null>(null);
  const sizeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const queueSize = useCallback(
    (raw: number, now = false) => {
      const n = normalizePetSize(raw);
      setSizeDraft(n);
      if (sizeTimer.current) clearTimeout(sizeTimer.current);
      const run = () => {
        sizeTimer.current = null;
        void Promise.resolve(commit({ ...prefsRef.current, sizePx: n })).finally(() =>
          setSizeDraft(null),
        );
      };
      if (now) run();
      else sizeTimer.current = setTimeout(run, 180);
    },
    [commit],
  );
  useEffect(
    () => () => {
      if (sizeTimer.current) clearTimeout(sizeTimer.current);
    },
    [],
  );

  const shown = petWindowOn(prefs);
  const shape: PetShape = isPetShape(prefs.shape) ? prefs.shape : "hex";
  const color: PetColor = isPetColor(prefs.color) ? prefs.color : "green";
  const eyeColor: PetEyeColor = normalizePetEyeColor(prefs.eyeColor);
  const expression = normalizePetExpression(prefs.expression);
  const sizePx = normalizePetSize(prefs.sizePx);

  return (
    <>
      <SettingsTabStrip
        tabs={sectionNav?.tabs ?? []}
        active={activeTab}
        onChange={setSectionTab}
        ariaLabel={title}
        t={(k) => t(k)}
      />

      {(activeTab === "look" || activeTab == null) && (
        <div className="settings-card pet-look">
          <div className="pet-look__toolbar">
            <div
              className={
                "pet-look__toolbar-item" + rowHighlight("settings-anchor-pet")
              }
              id="settings-anchor-pet"
            >
              <SettingsLabelWithTip
                label={t("settings.pet.enabled")}
                tip={t("settings.pet.enabledDesc")}
              />
              <UiSwitch
                checked={shown}
                disabled={busy}
                label={t("settings.pet.enabled")}
                onChange={(next) => void onToggleWindow(next)}
              />
            </div>
            <div
              className={
                "pet-look__toolbar-item" +
                rowHighlight("settings-anchor-pet-size")
              }
              id="settings-anchor-pet-size"
            >
              <SettingsLabelWithTip
                label={t("settings.pet.size")}
                tip={t("settings.pet.sizeDesc")}
              />
              <PetSizeSlider
                value={sizeDraft ?? sizePx}
                isDefault={sizePx === PET_SIZE_DEFAULT && sizeDraft == null}
                onChange={(n) => queueSize(n)}
                onReset={() => queueSize(PET_SIZE_DEFAULT, true)}
              />
            </div>
            <PetQuickHotkeyRow />
          </div>

          <div
            className={
              "pet-look__body" + rowHighlight("settings-anchor-pet-identity")
            }
            id="settings-anchor-pet-identity"
          >
            <div className="pet-look__preview">
              <PetMark
                shape={shape}
                color={color}
                eyeColor={eyeColor}
                expression={expression}
                verb="idle"
                sizePx={96}
                restOnly
              />
            </div>
            <div className="pet-look__fields">
              <div className="pet-look__field">
                <div className="pet-look__field-label">{t("settings.pet.shape")}</div>
                <div
                  className="pet-settings-grid"
                  role="group"
                  aria-label={t("settings.pet.shape")}
                >
                  {PET_PICKER_SHAPES.map((sh) => (
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
                        expression={expression}
                        verb="idle"
                        sizePx={26}
                        paused
                        restOnly
                      />
                    </button>
                  ))}
                </div>
              </div>
              <div
                className={
                  "pet-look__field" +
                  rowHighlight("settings-anchor-pet-expression")
                }
                id="settings-anchor-pet-expression"
              >
                <SettingsLabelWithTip
                  label={t("settings.pet.expression")}
                  tip={t("settings.pet.expressionDesc")}
                />
                <div
                  className="pet-settings-grid"
                  role="group"
                  aria-label={t("settings.pet.expression")}
                >
                  {PET_EXPRESSIONS.map((ex) => (
                    <button
                      key={ex}
                      type="button"
                      className={
                        "pet-settings-grid__btn" +
                        (expression === ex ? " is-on" : "")
                      }
                      aria-pressed={expression === ex}
                      aria-label={t(`settings.pet.expression.${ex}`)}
                      disabled={busy}
                      onClick={() => void commit({ ...prefs, expression: ex })}
                    >
                      <PetMark
                        shape={shape}
                        color={color}
                        eyeColor={eyeColor}
                        expression={ex}
                        verb="idle"
                        sizePx={26}
                        paused
                        restOnly
                      />
                    </button>
                  ))}
                </div>
              </div>
              <div className="pet-look__field">
                <div className="pet-look__field-label">{t("settings.pet.color")}</div>
                <div
                  className="pet-settings-grid"
                  role="group"
                  aria-label={t("settings.pet.color")}
                >
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
                className={
                  "pet-look__field" + rowHighlight("settings-anchor-pet-eye")
                }
                id="settings-anchor-pet-eye"
              >
                <SettingsLabelWithTip
                  label={t("settings.pet.eyeColor")}
                  tip={t("settings.pet.eyeColorDesc")}
                />
                <div
                  className="pet-settings-grid"
                  role="group"
                  aria-label={t("settings.pet.eyeColor")}
                >
                  <button
                    type="button"
                    className={
                      "pet-settings-grid__btn" +
                      (eyeColor === "auto" ? " is-on" : "")
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
                        "pet-settings-grid__btn" +
                        (eyeColor === c ? " is-on" : "")
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
          </div>
        </div>
      )}

      {activeTab === "bubbles" && (
        <>
          <h2 className="settings-page__h2">{t("settings.tab.petBubbles")}</h2>
          <div
            className={"settings-card" + rowHighlight("settings-anchor-pet-bubbles")}
            id="settings-anchor-pet-bubbles"
          >
            <div className="settings-row">
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
        </>
      )}
    </>
  );
}
