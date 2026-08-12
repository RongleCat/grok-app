/**
 * Interactive terminal tab — VS Code-style full PTY + xterm.
 * User operates the shell directly (no command input / log panes).
 * Spawns `$SHELL -l -i` so oh-my-zsh and user rc load.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { createT, type Locale } from "@/i18n";
import * as api from "@/lib/api";
import { listen } from "@/lib/api/host";
import type {
  TerminalPtyDataEvent,
  TerminalPtyExitEvent,
} from "@/lib/api/system";
import { buildSideTerminalTheme } from "@/lib/sideTerminalTheme";
import {
  TERMINAL_FONT_CHANGE_EVENT,
  loadTerminalFontPrefs,
  resolveTerminalFontFamily,
  type TerminalFontPrefs,
} from "@/lib/terminalFontPref";

export type TerminalTabProps = {
  locale: Locale | string;
  tabId: string;
  projectPath?: string | null;
  active?: boolean;
};

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
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [restartKey, setRestartKey] = useState(0);

  const clearListeners = useCallback(() => {
    const L = listenersRef.current;
    L.dataDisp?.dispose();
    L.unlistenData?.();
    L.unlistenExit?.();
    L.dataDisp = null;
    L.unlistenData = null;
    L.unlistenExit = null;
  }, []);

  // Create xterm once per mount; font follows Appearance → Terminal font prefs.
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;

    const bootFont = loadTerminalFontPrefs();
    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: "block",
      fontSize: bootFont.size,
      fontFamily: resolveTerminalFontFamily(bootFont.family),
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
    const applyFont = (prefs: TerminalFontPrefs) => {
      term.options.fontFamily = resolveTerminalFontFamily(prefs.family);
      term.options.fontSize = prefs.size;
      try {
        fitRef.current?.fit();
      } catch {
        /* ignore */
      }
    };
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
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

    const onFontChange = (ev: Event) => {
      const detail = (ev as CustomEvent<TerminalFontPrefs>).detail;
      if (detail && typeof detail === "object") {
        applyFont({
          family: typeof detail.family === "string" ? detail.family : "",
          size:
            typeof detail.size === "number"
              ? detail.size
              : loadTerminalFontPrefs().size,
        });
      } else {
        applyFont(loadTerminalFontPrefs());
      }
    };
    window.addEventListener(TERMINAL_FONT_CHANGE_EVENT, onFontChange);

    return () => {
      window.removeEventListener(TERMINAL_FONT_CHANGE_EVENT, onFontChange);
      mo?.disconnect();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, []);

  // Spawn PTY + wire I/O when desktop host is available.
  useEffect(() => {
    if (!api.isTauri()) {
      setError(tr("side.terminal.hostOnly"));
      return;
    }

    let cancelled = false;
    let sessionId: string | null = null;
    const gen = ++bootGenRef.current;

    const boot = async () => {
      setError(null);
      setReady(false);
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
          projectPath,
          cols,
          rows,
        });
        if (cancelled || bootGenRef.current !== gen) {
          void api.terminalPtyKill(spawned.sessionId);
          return;
        }
        sessionId = spawned.sessionId;
        sessionIdRef.current = sessionId;
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
          setError(String(e));
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
    // Re-spawn only on tab / project / explicit restart — not on `tr` identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId, projectPath, restartKey, clearListeners]);

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
      term.focus();
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

  return (
    <div
      className="sw-terminal sw-terminal--pty"
      data-testid="side-terminal-tab"
      data-tab-id={tabId}
      data-ready={ready ? "1" : "0"}
      data-interactive="1"
    >
      {error ? (
        <div className="rp__error" role="alert">
          {error}
          <button
            type="button"
            className="sw-terminal__restart sw-terminal__restart--inline"
            aria-label={tr("side.terminal.restart")}
            title={tr("side.terminal.restart")}
            onClick={() => {
              setError(null);
              setRestartKey((k) => k + 1);
            }}
          >
            ↻
          </button>
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
