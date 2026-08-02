/**
 * Bare thinking row (no tools in this burst) — Grok / Claude “Thought for Ns” chrome.
 *
 * Official rhythm:
 * - Streaming: 💡 Thinking  (or short gist)
 * - Done collapsed (default): 💡 Thought for 12s  >     ← ONLY this line
 * - Done expanded: 💡 Thought for 12s  ∨  + muted body
 *
 * Never use “思考完成” / raw first-line (“Quick note:”) as the chrome label.
 * Full markdown is dig-in only, never the collapsed surface.
 *
 * Tool bursts use TimelinePhaseBlock (“Worked for Ns”) instead.
 */

import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { IconBulb, IconChevronDown, IconChevronRight } from "@/components/icons";
import { cn } from "@/lib/utils";
import { MarkdownChat } from "./MarkdownChat";
import type { Locale } from "@/i18n";
import { COLLAPSE_ALL_ACTIVITY_EVENT } from "@/lib/collapseAllActivity";
import {
  loadThinkingExpandPref,
  saveThinkingExpandPref,
  thinkingDefaultOpenWhenDone,
  THINKING_PREF_EVENT,
  type ThinkingExpandPref,
} from "@/lib/thinkingPref";
import { extractThinkingSummary } from "@/lib/thinkingSummary";

export const Thinking = memo(function Thinking({
  content,
  thinking,
  durationMs,
  streamingLabel,
  doneLabel,
  thoughtForLabel,
  locale = "en",
  expandPref,
  onExpandPrefChange,
  onOpenExternalLink,
}: {
  content?: string | ReactNode;
  thinking?: boolean;
  /** Duration in ms when known (live timer or history). */
  durationMs?: number;
  streamingLabel: string;
  /** Fallback when no duration yet — should be short “Thought”, not “Reasoning complete”. */
  doneLabel: string;
  thoughtForLabel: (seconds: string) => string;
  locale?: Locale;
  expandPref?: ThinkingExpandPref;
  onExpandPrefChange?: (pref: ThinkingExpandPref) => void;
  onOpenExternalLink?: (url: string) => void;
}) {
  const [pref, setPref] = useState<ThinkingExpandPref>(
    () => expandPref ?? loadThinkingExpandPref(),
  );
  // Done → start collapsed (auto-collapse default). Streaming → open.
  const [open, setOpen] = useState(() =>
    thinking ? true : thinkingDefaultOpenWhenDone(pref),
  );
  const startRef = useRef<number | null>(null);
  const [localDuration, setLocalDuration] = useState<number | undefined>(
    durationMs,
  );
  const userToggled = useRef(false);
  const thinkingRef = useRef(!!thinking);
  thinkingRef.current = !!thinking;

  useEffect(() => {
    if (expandPref != null) setPref(expandPref);
  }, [expandPref]);

  useEffect(() => {
    if (expandPref != null) return;
    const apply = (next: ThinkingExpandPref) => {
      setPref(next);
      if (!thinkingRef.current && !userToggled.current) {
        setOpen(thinkingDefaultOpenWhenDone(next));
      }
    };
    const onPref = (e: Event) => {
      const detail = (e as CustomEvent<ThinkingExpandPref>).detail;
      apply(
        detail === "keep-open" || detail === "auto-collapse"
          ? detail
          : loadThinkingExpandPref(),
      );
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === "grok.thinkingExpanded") {
        apply(loadThinkingExpandPref());
      }
    };
    window.addEventListener(THINKING_PREF_EVENT, onPref);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(THINKING_PREF_EVENT, onPref);
      window.removeEventListener("storage", onStorage);
    };
  }, [expandPref]);

  useEffect(() => {
    const onCollapseAll = () => {
      if (thinkingRef.current) return;
      userToggled.current = true;
      setOpen(false);
    };
    window.addEventListener(COLLAPSE_ALL_ACTIVITY_EVENT, onCollapseAll);
    return () => {
      window.removeEventListener(COLLAPSE_ALL_ACTIVITY_EVENT, onCollapseAll);
    };
  }, []);

  useEffect(() => {
    if (thinking) {
      setOpen(true);
      userToggled.current = false;
      if (startRef.current == null) startRef.current = Date.now();
      return;
    }
    if (startRef.current != null) {
      setLocalDuration(Date.now() - startRef.current);
      startRef.current = null;
    }
    // Finished → collapse unless user prefers keep-open and hasn’t toggled.
    if (!userToggled.current) {
      setOpen(thinkingDefaultOpenWhenDone(pref));
    }
  }, [thinking, pref]);

  useEffect(() => {
    if (durationMs != null) setLocalDuration(durationMs);
  }, [durationMs]);

  /**
   * Chrome label (always duration-first when done):
   * - live: gist || “Thinking”
   * - done: “Thought for Ns” | fallback “Thought” (never “思考完成” / first line)
   */
  const chromeLabel = useMemo(() => {
    if (thinking) {
      const gist = extractThinkingSummary(
        typeof content === "string" ? content : "",
      );
      return gist || streamingLabel;
    }
    if (localDuration != null && localDuration >= 100) {
      // Whole seconds like Grok “Thought for 12s” (not 12.3)
      const sec = Math.max(1, Math.round(localDuration / 1000));
      return thoughtForLabel(String(sec));
    }
    return doneLabel;
  }, [thinking, content, streamingLabel, localDuration, thoughtForLabel, doneLabel]);

  const hasBody =
    (typeof content === "string" && content.trim().length > 0) ||
    (content != null && typeof content !== "string");

  const toggle = () => {
    if (!hasBody) return;
    setOpen((v) => {
      const next = !v;
      userToggled.current = true;
      if (!thinking) {
        const p: ThinkingExpandPref = next ? "keep-open" : "auto-collapse";
        saveThinkingExpandPref(p);
        onExpandPrefChange?.(p);
      }
      return next;
    });
  };

  return (
    <div
      className={
        "grok-thought" +
        (thinking ? " is-live" : "") +
        (open && hasBody ? " is-open" : " is-collapsed")
      }
      data-testid="thinking-block"
      data-expanded={open && hasBody ? "1" : "0"}
    >
      <button
        type="button"
        className="grok-thought__header"
        aria-expanded={hasBody ? open : undefined}
        onClick={toggle}
        disabled={!hasBody}
      >
        <span className="grok-thought__icon" aria-hidden>
          <IconBulb size={16} stroke={1.5} />
        </span>
        <span
          className={cn(
            "grok-thought__label",
            thinking && "grok-thought__label--live",
          )}
        >
          {chromeLabel}
        </span>
        {hasBody ? (
          <span className="grok-thought__caret" aria-hidden>
            {open ? (
              <IconChevronDown size={14} stroke={1.75} />
            ) : (
              <IconChevronRight size={14} stroke={1.75} />
            )}
          </span>
        ) : null}
      </button>

      {/* Collapsed: header only. Expanded: muted dig-in body. */}
      {open && hasBody ? (
        <div className="grok-thought__body">
          {typeof content === "string" ? (
            <MarkdownChat
              locale={locale}
              muted
              pathCards={false}
              onOpenExternalLink={onOpenExternalLink}
            >
              {content}
            </MarkdownChat>
          ) : (
            content
          )}
        </div>
      ) : null}
    </div>
  );
});
