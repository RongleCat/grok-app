/**
 * Pet quick-access hub — slim root for the `#/pet-quick` window (never boots
 * the workbench). Prompt + dictation, saved quick prompts, searchable
 * pinned/recent chats with live state, approve / deny / stop per chat.
 * Every action is delegated to the main window over async Host commands.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@/lib/api/host";
import { petFocusSession, petGetFocus, petGetTasks } from "@/lib/api/pet";
import {
  petQuickAction,
  petQuickHide,
  petQuickRecent,
  petQuickSend,
  type PetQuickRecent,
} from "@/lib/api/petQuick";
import type { PetFocus, PetKind, PetTask } from "@/lib/pet";
import {
  addSavedPrompt,
  buildHubRows,
  magneticOffset,
  moveHubSelection,
  parseSavedPrompts,
  removeSavedPrompt,
  SAVED_PROMPTS_KEY,
  type HubRow,
} from "@/lib/pet/petQuickHub";
import { usePetQuickVoice } from "./usePetQuickVoice";
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

const TONE_KEY = {
  idle: null,
  busy: "pet.quick.state.working",
  attention: "pet.quick.state.approval",
  done: "pet.quick.state.finished",
  error: "pet.quick.state.failed",
} as const;

function loadSaved(): string[] {
  try {
    return parseSavedPrompts(localStorage.getItem(SAVED_PROMPTS_KEY));
  } catch {
    return [];
  }
}

export function PetQuickApp() {
  const [locale, setLocale] = useState<Locale>(bootLocale);
  const [catalogRev, setCatalogRev] = useState(0);
  const [focus, setFocus] = useState<PetFocus | null>(null);
  const [recents, setRecents] = useState<PetQuickRecent[]>([]);
  const [tasks, setTasks] = useState<PetTask[]>([]);
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(-1);
  const [text, setText] = useState("");
  const [saved, setSaved] = useState<string[]>(loadSaved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<"above" | "below">("below");
  const [openRev, setOpenRev] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const magRef = useRef<{ el: HTMLElement | null; raf: number }>({ el: null, raf: 0 });

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const t = useMemo(() => createT(locale), [locale, catalogRev]);
  const voice = usePetQuickVoice(locale, (spoken) =>
    setText((cur) => (cur.trim() ? `${cur.trimEnd()} ${spoken}` : spoken)),
  );

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
    setError(null);
    setQuery("");
    setSel(-1);
    setOpenRev((n) => n + 1);
    void petQuickRecent().then(setRecents).catch(() => {});
    void petGetTasks().then(setTasks).catch(() => {});
    void petGetFocus().then((f) => setFocus(f)).catch(() => {});
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  useEffect(() => {
    refresh();
    const unsubs: Array<() => void> = [];
    const on = <T,>(ev: string, fn: (p: T) => void) =>
      void listen<T>(ev, fn).then((u) => unsubs.push(u));
    on<PetFocus>("pet://focus", (f) => {
      if (f?.kind) setFocus(f);
    });
    on<PetTask[]>("pet://tasks", (rows) => {
      if (Array.isArray(rows)) setTasks(rows);
    });
    on<string>("pet-quick://anchor", (a) => setAnchor(a === "above" ? "above" : "below"));
    on("pet-quick://shown", () => refresh());
    on("pet-quick://hidden", () => voice.cancel());
    return () => {
      for (const u of unsubs) u();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh]);

  const groups = useMemo(() => buildHubRows(recents, tasks, query), [recents, tasks, query]);
  const flat = useMemo(() => [...groups.pinned, ...groups.recent], [groups]);
  const selected: HubRow | null = sel >= 0 ? (flat[sel] ?? null) : null;
  // Target: keyboard-selected chat, else the chat the pet shows, else new.
  const targetId =
    selected?.id ??
    (focus?.sessionId && recents.some((r) => r.id === focus.sessionId) ? focus.sessionId : null);
  const untitled = t("pet.quick.untitled");
  const targetTitle = targetId
    ? (recents.find((r) => r.id === targetId)?.title || untitled)
    : t("pet.quick.newChat");

  const persistSaved = (next: string[]) => {
    setSaved(next);
    try {
      localStorage.setItem(SAVED_PROMPTS_KEY, JSON.stringify(next));
    } catch {
      /* private mode */
    }
  };

  const submit = useCallback(
    async (openMain: boolean, sessionId: string | null = targetId) => {
      const body = text.trim();
      if (!body || busy) return;
      setBusy(true);
      setError(null);
      try {
        await petQuickSend({ sessionId, text: body, openMain });
        setText("");
      } catch {
        setError(t("pet.quick.sendFailed"));
      } finally {
        setBusy(false);
      }
    },
    [busy, t, targetId, text],
  );

  const activate = (row: HubRow, openMain = false) => {
    if (text.trim()) void submit(openMain, row.id);
    else void petFocusSession(row.id).then(() => petQuickHide());
  };

  const onRootKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      if (voice.phase === "recording") voice.cancel();
      else void petQuickHide();
      return;
    }
    if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !e.shiftKey) {
      e.preventDefault();
      setSel((cur) => moveHubSelection(cur, e.key === "ArrowDown" ? 1 : -1, flat.length));
    }
  };

  const onPromptKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (!text.trim() && selected) activate(selected);
      else void submit(e.ctrlKey || e.metaKey);
    }
  };

  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const row = selected ?? flat[0];
      if (row) activate(row, e.ctrlKey || e.metaKey);
    }
  };

  // Magnetic hover: one delegated, rAF-throttled handler; transform only.
  const onPointerMove = (e: React.PointerEvent) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>(".pq-mag");
    const m = magRef.current;
    if (m.el && m.el !== el) m.el.style.removeProperty("--pq-m");
    m.el = el;
    if (!el || m.raf) return;
    const { clientX, clientY } = e;
    m.raf = requestAnimationFrame(() => {
      m.raf = 0;
      const [dx, dy] = magneticOffset(clientX, clientY, el.getBoundingClientRect());
      el.style.setProperty("--pq-m", `translate3d(${dx}px, ${dy}px, 0)`);
    });
  };
  const onPointerLeave = () => {
    magRef.current.el?.style.removeProperty("--pq-m");
    magRef.current.el = null;
  };

  const badge = petQuickBadge(focus?.kind);
  const micLabel = voice.phase === "recording" ? t("pet.quick.micStop") : t("pet.quick.mic");
  let rowIndex = -1;

  const renderRow = (r: HubRow) => {
    rowIndex += 1;
    const idx = rowIndex;
    const toneKey = TONE_KEY[r.tone];
    return (
      <li key={r.id} className="pq-row-wrap" style={{ "--i": Math.min(idx, 12) } as React.CSSProperties}>
        <div
          className={
            "pq-row" +
            (idx === sel ? " pq-row--sel" : "") +
            (r.id === focus?.sessionId ? " pq-row--focus" : "")
          }
          role="option"
          aria-selected={idx === sel}
        >
          <button
            type="button"
            className="pq-row__main"
            title={text.trim() ? t("pet.quick.sendHere") : t("pet.quick.openChat")}
            onClick={() => activate(r)}
            onMouseEnter={() => setSel(idx)}
          >
            <span className={`pq-dot pq-dot--${r.tone}`} aria-hidden />
            <span className="pq-row__text">
              <span className="pq-row__title">{r.title || untitled}</span>
              <span className="pq-row__sub">
                {toneKey ? <b className={`pq-tone pq-tone--${r.tone}`}>{t(toneKey)}</b> : null}
                {r.snippet || r.project}
              </span>
            </span>
          </button>
          {r.tone === "attention" ? (
            <>
              <button type="button" className="pq-chip pq-chip--ok pq-mag" onClick={() => void petQuickAction("approve", r.id)}>
                {t("pet.quick.approve")}
              </button>
              <button type="button" className="pq-chip pq-chip--no pq-mag" onClick={() => void petQuickAction("deny", r.id)}>
                {t("pet.quick.deny")}
              </button>
            </>
          ) : null}
          {r.tone === "busy" ? (
            <button type="button" className="pq-chip pq-chip--stop pq-mag" onClick={() => void petQuickAction("stop", r.id)}>
              {t("pet.quick.stop")}
            </button>
          ) : null}
        </div>
      </li>
    );
  };

  return (
    <div
      key={openRev}
      className="pq"
      data-anchor={anchor}
      onKeyDown={onRootKey}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
    >
      <header className="pq-head" data-tauri-drag-region>
        <span className={`pet-quick__badge pet-quick__badge--${badge.tone}`} aria-hidden />
        <span className="pq-head__state" data-tauri-drag-region>
          {t(badge.key)}
          {focus?.title ? <span className="pet-quick__focus"> · {focus.title}</span> : null}
        </span>
        <button
          type="button"
          className="pq-icon pq-mag"
          aria-label={t("pet.quick.close")}
          title={t("pet.quick.close")}
          onClick={() => void petQuickHide()}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
            <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      </header>

      <div className="pq-prompt pq-reveal" style={{ "--i": 0 } as React.CSSProperties}>
        <textarea
          ref={inputRef}
          className="pq-input"
          rows={3}
          value={voice.phase === "recording" && voice.live ? `${text}${text ? " " : ""}${voice.live}` : text}
          placeholder={t("pet.quick.placeholder")}
          aria-label={t("pet.quick.placeholder")}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onPromptKey}
          disabled={busy}
          readOnly={voice.phase === "recording"}
        />
        <div className="pq-prompt__tools">
          <button
            type="button"
            className={`pq-icon pq-mag pq-mic pq-mic--${voice.phase}`}
            aria-label={micLabel}
            title={micLabel}
            aria-pressed={voice.phase === "recording"}
            onClick={voice.toggle}
            disabled={voice.phase === "transcribing"}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
              <rect x="5.5" y="1.5" width="5" height="9" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <path d="M3 7.5a5 5 0 0 0 10 0M8 12.5v2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
          <button
            type="button"
            className="pq-icon pq-mag"
            aria-label={t("pet.quick.saveCurrent")}
            title={t("pet.quick.saveCurrent")}
            disabled={!text.trim()}
            onClick={() => persistSaved(addSavedPrompt(saved, text))}
          >
            ☆
          </button>
        </div>
      </div>
      {voice.phase !== "idle" ? (
        <div className={`pq-voice pq-voice--${voice.phase}`} role="status">
          {voice.phase === "recording"
            ? t("pet.quick.listening")
            : voice.phase === "transcribing"
              ? t("pet.quick.transcribing")
              : t("pet.quick.voiceFailed")}
        </div>
      ) : null}

      <div className="pq-send pq-reveal" style={{ "--i": 1 } as React.CSSProperties}>
        <span className="pq-target" title={t("pet.quick.target")}>→ {targetTitle}</span>
        <button
          type="button"
          className="pq-btn pq-mag"
          disabled={!text.trim() || busy}
          title={t("pet.quick.sendOpenHint")}
          onClick={() => void submit(true)}
        >
          {t("pet.quick.sendOpen")}
        </button>
        <button
          type="button"
          className="pq-btn pq-btn--primary pq-mag"
          disabled={!text.trim() || busy}
          title={t("pet.quick.sendHint")}
          onClick={() => void submit(false)}
        >
          {t("pet.quick.send")}
        </button>
      </div>
      {error ? <div className="pq-error" role="alert">{error}</div> : null}

      <div className="pq-saved pq-reveal" style={{ "--i": 2 } as React.CSSProperties} aria-label={t("pet.quick.saved")}>
        {saved.length === 0 ? (
          <span className="pq-muted">{t("pet.quick.savedEmpty")}</span>
        ) : (
          saved.map((p) => (
            <span key={p} className="pq-saved__item pq-mag">
              <button type="button" className="pq-saved__use" title={p} onClick={() => setText(p)}>
                {p}
              </button>
              <button
                type="button"
                className="pq-saved__x"
                aria-label={t("pet.quick.removeSaved")}
                title={t("pet.quick.removeSaved")}
                onClick={() => persistSaved(removeSavedPrompt(saved, p))}
              >
                ×
              </button>
            </span>
          ))
        )}
      </div>

      <input
        className="pq-search pq-reveal"
        style={{ "--i": 3 } as React.CSSProperties}
        type="search"
        value={query}
        placeholder={t("pet.quick.search")}
        aria-label={t("pet.quick.search")}
        onChange={(e) => {
          setQuery(e.target.value);
          setSel(-1);
        }}
        onKeyDown={onSearchKey}
      />

      <div className="pq-list" role="listbox" aria-label={t("pet.quick.recent")}>
        {flat.length === 0 ? (
          <div className="pq-muted pq-empty">{query ? t("pet.quick.noMatch") : t("pet.quick.noRecent")}</div>
        ) : null}
        {groups.pinned.length ? (
          <>
            <div className="pq-group">{t("pet.quick.pinned")}</div>
            <ul>{groups.pinned.map(renderRow)}</ul>
          </>
        ) : null}
        {groups.recent.length ? (
          <>
            <div className="pq-group">{t("pet.quick.recent")}</div>
            <ul>{groups.recent.map(renderRow)}</ul>
          </>
        ) : null}
      </div>
      <footer className="pq-foot">{t("pet.quick.navHint")}</footer>
    </div>
  );
}
