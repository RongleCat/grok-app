/**
 * Pet quick bar — slim root for the `#/pet-quick` window. Does not boot the
 * workbench: one textarea, a target picker, and the recent-chat list. Sending
 * is delegated to the main window (`pet_quick_send` → `pet://quick-prompt`).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@/lib/api/host";
import { petFocusSession, petGetFocus } from "@/lib/api/pet";
import {
  petQuickHide,
  petQuickRecent,
  petQuickSend,
  type PetQuickRecent,
} from "@/lib/api/petQuick";
import type { PetFocus, PetKind } from "@/lib/pet";
import {
  createT,
  htmlLangForLocale,
  loadLocaleCatalog,
  parseLocalePreference,
  resolveLocale,
  resolveLocalePreference,
  type Locale,
} from "@/i18n";
import { settingsGet } from "@/lib/api/settings";
import "@/styles/pet-quick.css";

const NEW_CHAT = "__new__";

/** Pure: badge tone + label key for the focused chat's state. */
export function petQuickBadge(kind: PetKind | null | undefined): {
  tone: "idle" | "busy" | "attention" | "done" | "error";
  key:
    | "pet.quick.state.idle"
    | "pet.quick.state.thinking"
    | "pet.quick.state.needsYou"
    | "pet.quick.state.done"
    | "pet.quick.state.error";
} {
  switch (kind) {
    case "working":
    case "connecting":
      return { tone: "busy", key: "pet.quick.state.thinking" };
    case "needs_you":
      return { tone: "attention", key: "pet.quick.state.needsYou" };
    case "ready":
      return { tone: "done", key: "pet.quick.state.done" };
    case "error":
      return { tone: "error", key: "pet.quick.state.error" };
    default:
      return { tone: "idle", key: "pet.quick.state.idle" };
  }
}

function bootLocale(): Locale {
  try {
    const w = window as Window & { __GROK_BOOT_LOCALE__?: string };
    if (typeof w.__GROK_BOOT_LOCALE__ === "string" && w.__GROK_BOOT_LOCALE__.trim()) {
      return resolveLocale(w.__GROK_BOOT_LOCALE__);
    }
    return resolveLocale(navigator.language);
  } catch {
    return "en";
  }
}

export function PetQuickApp() {
  const [locale, setLocale] = useState<Locale>(bootLocale);
  const [catalogRev, setCatalogRev] = useState(0);
  const [focus, setFocus] = useState<PetFocus | null>(null);
  const [recents, setRecents] = useState<PetQuickRecent[]>([]);
  const [target, setTarget] = useState<string>(NEW_CHAT);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const targetTouched = useRef(false);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const t = useMemo(() => createT(locale), [locale, catalogRev]);

  useEffect(() => {
    document.documentElement.setAttribute("data-pet-quick", "1");
    document.body.style.background = "transparent";
    document.querySelector(".boot-gate")?.setAttribute("hidden", "");
    void settingsGet()
      .then((s) => setLocale(resolveLocalePreference(parseLocalePreference(s.locale))))
      .catch(() => {});
  }, []);

  useEffect(() => {
    let gone = false;
    void loadLocaleCatalog(locale).then(() => {
      if (!gone) setCatalogRev((n) => n + 1);
    });
    document.documentElement.setAttribute("lang", htmlLangForLocale(locale));
    return () => {
      gone = true;
    };
  }, [locale]);

  const refresh = useCallback(() => {
    targetTouched.current = false;
    setError(null);
    void petQuickRecent().then(setRecents).catch(() => {});
    void petGetFocus().then((f) => setFocus(f)).catch(() => {});
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  useEffect(() => {
    refresh();
    const unsubs: Array<() => void> = [];
    void listen<PetFocus>("pet://focus", (f) => {
      if (f?.kind) setFocus(f);
    }).then((u) => unsubs.push(u));
    void listen("pet-quick://shown", () => refresh()).then((u) => unsubs.push(u));
    return () => {
      for (const u of unsubs) u();
    };
  }, [refresh]);

  // Default target: the chat the pet is showing, else a new chat.
  useEffect(() => {
    if (targetTouched.current) return;
    const sid = focus?.sessionId;
    setTarget(sid && recents.some((r) => r.id === sid) ? sid : NEW_CHAT);
  }, [focus?.sessionId, recents]);

  const submit = useCallback(
    async (openMain: boolean) => {
      const body = text.trim();
      if (!body || busy) return;
      setBusy(true);
      setError(null);
      try {
        await petQuickSend({
          sessionId: target === NEW_CHAT ? null : target,
          text: body,
          openMain,
        });
        setText("");
      } catch {
        setError(t("pet.quick.sendFailed"));
      } finally {
        setBusy(false);
      }
    },
    [busy, t, target, text],
  );

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      void petQuickHide();
    } else if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit(e.ctrlKey || e.metaKey);
    }
  };

  const badge = petQuickBadge(focus?.kind);
  const untitled = t("pet.quick.untitled");

  return (
    <div
      className="pet-quick"
      onKeyDown={(e) => {
        if (e.key === "Escape") void petQuickHide();
      }}
    >
      <header className="pet-quick__head" data-tauri-drag-region>
        <span className={`pet-quick__badge pet-quick__badge--${badge.tone}`} aria-hidden />
        <span className="pet-quick__state" data-tauri-drag-region>
          {t(badge.key)}
          {focus?.title ? <span className="pet-quick__focus"> · {focus.title}</span> : null}
        </span>
        <button
          type="button"
          className="pet-quick__icon"
          aria-label={t("pet.quick.close")}
          title={t("pet.quick.close")}
          onClick={() => void petQuickHide()}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
            <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      </header>

      <textarea
        ref={inputRef}
        className="pet-quick__input"
        rows={3}
        value={text}
        placeholder={t("pet.quick.placeholder")}
        aria-label={t("pet.quick.placeholder")}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        disabled={busy}
      />

      <div className="pet-quick__bar">
        <select
          className="pet-quick__target"
          value={target}
          aria-label={t("pet.quick.target")}
          onChange={(e) => {
            targetTouched.current = true;
            setTarget(e.target.value);
          }}
        >
          <option value={NEW_CHAT}>{t("pet.quick.newChat")}</option>
          {recents.map((r) => (
            <option key={r.id} value={r.id}>
              {(r.pinned ? "★ " : "") + (r.title || untitled)}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="pet-quick__btn"
          disabled={!text.trim() || busy}
          title={t("pet.quick.sendOpenHint")}
          onClick={() => void submit(true)}
        >
          {t("pet.quick.sendOpen")}
        </button>
        <button
          type="button"
          className="pet-quick__btn pet-quick__btn--primary"
          disabled={!text.trim() || busy}
          title={t("pet.quick.sendHint")}
          onClick={() => void submit(false)}
        >
          {t("pet.quick.send")}
        </button>
      </div>
      {error ? <div className="pet-quick__error" role="alert">{error}</div> : null}

      <div className="pet-quick__recent-head">{t("pet.quick.recent")}</div>
      <ul className="pet-quick__recent">
        {recents.length === 0 ? (
          <li className="pet-quick__empty">{t("pet.quick.noRecent")}</li>
        ) : (
          recents.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                className={
                  "pet-quick__row" + (r.id === focus?.sessionId ? " pet-quick__row--focus" : "")
                }
                title={t("pet.quick.openChat")}
                onClick={() => {
                  void petFocusSession(r.id).then(() => petQuickHide());
                }}
              >
                <span className="pet-quick__row-title">{r.title || untitled}</span>
                {r.project ? <span className="pet-quick__row-proj">{r.project}</span> : null}
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
