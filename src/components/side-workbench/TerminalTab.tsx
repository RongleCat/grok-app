/**
 * Interactive terminal tab — VS Code-style full PTY + xterm.
 * User operates the shell directly (no command input / log panes).
 * Spawns `$SHELL -l -i` so oh-my-zsh and user rc load.
 *
 * Cwd is bound at spawn from the active project (else home). Live PTY cannot
 * chdir when the project switches — we surface honesty + restart instead of
 * silently killing the shell.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";
import { createT, type Locale, type MessageKey } from "@/i18n";
import * as api from "@/lib/api";
import { listen } from "@/lib/api/host";
import type {
  TerminalPtyDataEvent,
  TerminalPtyExitEvent,
} from "@/lib/api/system";
import { buildSideTerminalTheme } from "@/lib/sideTerminalTheme";
import {
  classifyTerminalCwdHonesty,
  classifyTerminalSpawnCwd,
  classifyTerminalSpawnError,
  normalizeTerminalCwd,
  type TerminalCwdHonesty,
} from "@/lib/sideTerminal";
import {
  loadTerminalFontFamily,
  loadTerminalFontSize,
  resolveTerminalFontFamily,
  TERMINAL_FONT_CHANGED_EVENT,
  TERMINAL_FONT_FAMILY_STORAGE_KEY,
  TERMINAL_FONT_SIZE_STORAGE_KEY,
} from "@/lib/terminalFontPref";

export type TerminalTabProps = {
  locale: Locale | string;
  tabId: string;
  projectPath?: string | null;
  active?: boolean;
};

function honestyDisplay(
  tr: (key: MessageKey, vars?: Record<string, string | number | null | undefined>) => string,
  h: TerminalCwdHonesty,
  exitCode?: number | null,
): string {
  if (h.kind === "none" || !h.messageKey) return "";
  const key = h.messageKey as MessageKey;
  if (h.kind === "session_ended") {
    return tr(key, {
      code: exitCode != null ? String(exitCode) : "?",
    });
  }
  if (h.kind === "spawn_failed") {
    const base = tr(key);
    return h.detail ? `${base} ${h.detail}` : base;
  }
  if (
    h.kind === "project_mismatch" ||
    h.kind === "project_fallback" ||
    h.kind === "no_project"
  ) {
    return tr(key, {
      bound: h.boundCwd || "—",
      desired: h.desiredCwd || "—",
    });
  }
  return tr(key);
}

export function TerminalTab({
  locale,
  tabId,
  projectPath,
  active = true,
}: TerminalTabProps) {
  const tr = useMemo(() => createT(locale as Locale), [locale]);
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  /** Bumps on every boot/cleanup so stale exit events are ignored. */
  const bootGenRef = useRef(0);
  const listenersRef = useRef<{
    unlistenData: (() => void) | null;
    unlistenExit: (() => void) | null;
    dataDisp: { dispose: () => void } | null;
  }>({ unlistenData: null, unlistenExit: null, dataDisp: null });
  /** Project path at last successful/failed boot (for honesty, not auto-respawn). */
  const bootProjectRef = useRef<string | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [restartKey, setRestartKey] = useState(0);
  const [boundCwd, setBoundCwd] = useState<string | null>(null);
  const [sessionEnded, setSessionEnded] = useState(false);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [spawnClassified, setSpawnClassified] = useState<ReturnType<
    typeof classifyTerminalSpawnCwd
  > | null>(null);

  const clearListeners = useCallback(() => {
    const L = listenersRef.current;
    L.dataDisp?.dispose();
    L.unlistenData?.();
    L.unlistenExit?.();
    L.dataDisp = null;
    L.unlistenData = null;
    L.unlistenExit = null;
  }, []);

  const applyFontPrefs = useCallback(() => {
    const term = termRef.current;
    if (!term) return;
    try {
      term.options.fontSize = loadTerminalFontSize();
      term.options.fontFamily = resolveTerminalFontFamily(
        loadTerminalFontFamily(),
      );
      fitRef.current?.fit();
      const sid = sessionIdRef.current;
      if (sid && term.cols && term.rows) {
        void api
          .terminalPtyResize(sid, term.cols, term.rows)
          .catch(() => undefined);
      }
    } catch {
      /* ignore */
    }
  }, []);

  // Create xterm once per mount.
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: "block",
      fontSize: loadTerminalFontSize(),
      fontFamily: resolveTerminalFontFamily(loadTerminalFontFamily()),
      fontWeight: "400",
      fontWeightBold: "700",
      // WebGL addon draws Powerline extra glyphs (U+E0B0–E0B6) from cell colors.
      // Built-in DOM renderer ignores customGlyphs and needs a patched font.
      customGlyphs: true,
      // lineHeight > 1 leaves a fractional-cell gap (looks like a bottom black bar).
      lineHeight: 1,
      letterSpacing: 0,
      scrollback: 5000,
      convertEol: false,
      // 50% opacity surface — need transparency so aside/wallpaper shows through.
      allowTransparency: true,
      theme: buildSideTerminalTheme(el),
    });
    const applyTheme = () => {
      term.options.theme = buildSideTerminalTheme(el);
    };
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    // xterm 6 defaults to the DOM renderer (customGlyphs off). WebGL draws
    // Powerline extras from cell fg/bg so Starship pills look like iTerm.
    let webgl: WebglAddon | null = null;
    try {
      webgl = new WebglAddon();
      webgl.onContextLoss(() => {
        try {
          webgl?.dispose();
        } catch {
          /* already gone */
        }
        webgl = null;
      });
      term.loadAddon(webgl);
    } catch {
      webgl = null;
    }
    // Sample computed surface after paint (color-mix resolved).
    requestAnimationFrame(() => {
      applyTheme();
      try {
        fit.fit();
      } catch {
        /* ignore */
      }
    });
    try {
      fit.fit();
    } catch {
      /* ignore first fit before layout */
    }
    const fontsReady =
      typeof document !== "undefined" && document.fonts?.ready
        ? document.fonts.ready.then(() => {
            try {
              term.refresh(0, term.rows - 1);
              fit.fit();
            } catch {
              /* unmounted */
            }
          })
        : null;
    void fontsReady;
    termRef.current = term;
    fitRef.current = fit;

    // Re-apply theme if the app skin/wallpaper tokens change.
    const mo =
      typeof MutationObserver !== "undefined"
        ? new MutationObserver(() => {
            applyTheme();
          })
        : null;
    mo?.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "data-wallpaper", "class", "style"],
    });

    return () => {
      mo?.disconnect();
      try {
        webgl?.dispose();
      } catch {
        /* ignore */
      }
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, []);

  // Live font prefs (Appearance) — same-tab event + cross-tab storage.
  useEffect(() => {
    const onPref = () => applyFontPrefs();
    const onStorage = (e: StorageEvent) => {
      if (
        e.key === TERMINAL_FONT_FAMILY_STORAGE_KEY ||
        e.key === TERMINAL_FONT_SIZE_STORAGE_KEY ||
        e.key === null
      ) {
        applyFontPrefs();
      }
    };
    window.addEventListener(TERMINAL_FONT_CHANGED_EVENT, onPref);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(TERMINAL_FONT_CHANGED_EVENT, onPref);
      window.removeEventListener("storage", onStorage);
    };
  }, [applyFontPrefs]);

  // Spawn PTY + wire I/O when desktop host is available.
  // Re-spawn only on tab / explicit restart — not on projectPath (live PTY
  // cannot chdir; mismatch honesty + restart instead).
  useEffect(() => {
    if (!api.isTauri()) {
      setError(tr("side.terminal.hostOnly"));
      setReady(false);
      setSessionEnded(false);
      setBoundCwd(null);
      setSpawnClassified(null);
      return;
    }

    let cancelled = false;
    let sessionId: string | null = null;
    const gen = ++bootGenRef.current;
    bootProjectRef.current = (projectPath || "").trim() || null;

    const boot = async () => {
      setError(null);
      setReady(false);
      setSessionEnded(false);
      setExitCode(null);
      setBoundCwd(null);
      setSpawnClassified(null);
      const term = termRef.current;
      const fit = fitRef.current;
      if (!term) return;

      clearListeners();

      // Wait a frame so xterm has real dimensions after tab show / Strict remount.
      await new Promise<void>((r) => {
        requestAnimationFrame(() => r());
      });
      if (cancelled || bootGenRef.current !== gen) return;

      try {
        fit?.fit();
      } catch {
        /* ignore */
      }
      const cols = Math.max(20, term.cols || 80);
      const rows = Math.max(5, term.rows || 24);

      try {
        // Always let host allocate a fresh UUID — never reuse tab-scoped ids
        // (old reader EOF would remove the new session from the map).
        const spawned = await api.terminalPtySpawn({
          sessionId: null,
          projectPath: bootProjectRef.current,
          cols,
          rows,
        });
        if (cancelled || bootGenRef.current !== gen) {
          void api.terminalPtyKill(spawned.sessionId);
          return;
        }
        sessionId = spawned.sessionId;
        sessionIdRef.current = sessionId;
        const bound = normalizeTerminalCwd(spawned.cwd) || spawned.cwd;
        setBoundCwd(bound);
        setSpawnClassified(
          classifyTerminalSpawnCwd({
            projectPath: bootProjectRef.current,
            boundCwd: bound,
          }),
        );
        setReady(true);

        listenersRef.current.dataDisp = term.onData((data) => {
          const sid = sessionIdRef.current;
          if (!sid || bootGenRef.current !== gen) return;
          void api.terminalPtyWrite(sid, data).catch(() => undefined);
        });

        listenersRef.current.unlistenData = await listen<TerminalPtyDataEvent>(
          "terminal://data",
          (p) => {
            if (bootGenRef.current !== gen) return;
            if (p.sessionId !== sessionIdRef.current) return;
            term.write(p.data);
          },
        );
        listenersRef.current.unlistenExit = await listen<TerminalPtyExitEvent>(
          "terminal://exit",
          (p) => {
            if (bootGenRef.current !== gen) return;
            if (p.sessionId !== sessionIdRef.current) return;
            // Intentional teardown (tab close / restart) — stay silent.
            if (cancelled) return;
            term.writeln("");
            term.writeln(
              tr("side.terminal.sessionEnded", {
                code: p.code != null ? String(p.code) : "?",
              }),
            );
            sessionIdRef.current = null;
            setReady(false);
            setSessionEnded(true);
            setExitCode(p.code ?? null);
          },
        );

        // Apply size once session is live (hidden hosts start at 0×0 sometimes).
        try {
          fit?.fit();
          if (term.cols && term.rows) {
            void api
              .terminalPtyResize(sessionId, term.cols, term.rows)
              .catch(() => undefined);
          }
        } catch {
          /* ignore */
        }

        if (active) term.focus();
      } catch (e) {
        if (!cancelled && bootGenRef.current === gen) {
          const soft = classifyTerminalSpawnError(e);
          setError(
            soft.detail
              ? `${tr(soft.messageKey as MessageKey)} ${soft.detail}`
              : tr(soft.messageKey as MessageKey),
          );
          setReady(false);
        }
      }
    };

    void boot();

    return () => {
      cancelled = true;
      bootGenRef.current += 1; // invalidate any in-flight boot / exit handlers
      clearListeners();
      const sid = sessionIdRef.current || sessionId;
      sessionIdRef.current = null;
      if (sid) void api.terminalPtyKill(sid).catch(() => undefined);
    };
    // projectPath is read at boot via bootProjectRef; restart picks up latest.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId, restartKey, clearListeners]);

  // Focus + fit when becoming active / container resizes.
  useEffect(() => {
    if (!active) return;
    const term = termRef.current;
    const fit = fitRef.current;
    const el = hostRef.current;
    if (!term || !el) return;

    const apply = () => {
      try {
        // Refresh theme from CSS tokens (skin may have changed while hidden).
        term.options.theme = buildSideTerminalTheme(el);
        fit?.fit();
      } catch {
        /* ignore */
      }
      const sid = sessionIdRef.current;
      if (sid && term.cols && term.rows) {
        void api
          .terminalPtyResize(sid, term.cols, term.rows)
          .catch(() => undefined);
      }
    };

    const t = window.setTimeout(apply, 0);
    const t2 = window.setTimeout(apply, 50);
    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => apply())
        : null;
    ro?.observe(el);
    window.addEventListener("resize", apply);
    return () => {
      window.clearTimeout(t);
      window.clearTimeout(t2);
      ro?.disconnect();
      window.removeEventListener("resize", apply);
    };
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const term = termRef.current;
    if (term) term.focus();
  }, [active]);

  const honesty = useMemo(
    () =>
      classifyTerminalCwdHonesty({
        isTauri: api.isTauri(),
        projectPath,
        boundCwd,
        sessionEnded,
        exitCode,
        spawnError: error,
        spawnClassified,
        ready,
      }),
    [
      projectPath,
      boundCwd,
      sessionEnded,
      exitCode,
      error,
      spawnClassified,
      ready,
    ],
  );

  const honestyText = useMemo(
    () => honestyDisplay(tr, honesty, exitCode),
    [tr, honesty, exitCode],
  );

  const showHonestyBar =
    honesty.kind !== "none" &&
    // spawn_failed / host_only already render via error strip; avoid double.
    honesty.kind !== "spawn_failed" &&
    honesty.kind !== "host_only";

  const onRestart = useCallback(() => {
    setError(null);
    setSessionEnded(false);
    setExitCode(null);
    setSpawnClassified(null);
    setRestartKey((k) => k + 1);
  }, []);

  return (
    <div
      className="sw-terminal sw-terminal--pty"
      data-testid="side-terminal-tab"
      data-tab-id={tabId}
      data-ready={ready ? "1" : "0"}
      data-bound-cwd={boundCwd || ""}
      data-cwd-honesty={honesty.kind}
      data-interactive="1"
    >
      {error ? (
        <div className="sw-terminal__notice rp__error" role="alert">
          <span className="sw-terminal__notice-text">{error}</span>
          <button
            type="button"
            className="sw-terminal__restart sw-terminal__restart--inline"
            aria-label={tr("side.terminal.restart")}
            title={tr("side.terminal.restart")}
            onClick={onRestart}
          >
            ↻
          </button>
        </div>
      ) : null}
      {showHonestyBar && honestyText ? (
        <div
          className="sw-terminal__notice"
          role="status"
          data-testid="side-terminal-cwd-notice"
          data-kind={honesty.kind}
        >
          <span className="sw-terminal__notice-text">{honestyText}</span>
          {honesty.kind === "project_mismatch" ||
          honesty.kind === "project_fallback" ||
          honesty.kind === "session_ended" ? (
            <button
              type="button"
              className="sw-terminal__restart sw-terminal__restart--inline"
              aria-label={
                honesty.kind === "project_mismatch"
                  ? tr("side.terminal.restartInProject")
                  : tr("side.terminal.restart")
              }
              title={
                honesty.kind === "project_mismatch"
                  ? tr("side.terminal.restartInProject")
                  : tr("side.terminal.restart")
              }
              onClick={onRestart}
            >
              ↻
            </button>
          ) : null}
        </div>
      ) : null}
      <div
        ref={hostRef}
        className="sw-terminal__xterm"
        data-testid="side-terminal-xterm"
        onMouseDown={() => termRef.current?.focus()}
      />
    </div>
  );
}
