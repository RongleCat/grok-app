/**
 * Lobe Thinking — collapsible reasoning row.
 *
 * Label model (CodePilot / Opencode):
 * - Prefer content summary (**bold** / # heading / first line)
 * - Never show dumb counters like "思考 1 / 思考 2"
 * - Streaming without summary → streamingLabel ("思考中…")
 * - Done without summary → duration ("思考了 Ns") or doneLabel
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { IconChevronDown } from "@/components/icons";
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

export function Thinking({
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
  /** Duration in ms (Lobe stores ms). */
  durationMs?: number;
  streamingLabel: string;
  doneLabel: string;
  /** e.g. "Thought for {n}s" — n is seconds with 1 decimal */
  thoughtForLabel: (seconds: string) => string;
  locale?: Locale;
  /** Override stored preference (tests / parent). */
  expandPref?: ThinkingExpandPref;
  onExpandPrefChange?: (pref: ThinkingExpandPref) => void;
  /** Open external http(s) links from thinking markdown. */
  onOpenExternalLink?: (url: string) => void;
}) {
  const [pref, setPref] = useState<ThinkingExpandPref>(
    () => expandPref ?? loadThinkingExpandPref(),
  );
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

  // Honor prop override (tests / parent).
  useEffect(() => {
    if (expandPref != null) setPref(expandPref);
  }, [expandPref]);

  // Settings (or another tab) changed the preference — apply to finished blocks
  // the user has not manually toggled.
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

  // Collapse all activity: force closed finished blocks only (leave streaming open).
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
    // Segment finished (thought → content/tools, or turn idle).
    if (startRef.current != null) {
      setLocalDuration(Date.now() - startRef.current);
      startRef.current = null;
    }
    // Always auto-collapse when done unless user prefers keep-open or
    // manually toggled this block open after it finished.
    if (!userToggled.current) {
      setOpen(thinkingDefaultOpenWhenDone(pref));
    }
  }, [thinking, pref]);

  useEffect(() => {
    if (durationMs != null) setLocalDuration(durationMs);
  }, [durationMs]);

  // Avoid "Thought for 0.0s" for sub-100ms phases.
  const durationText =
    localDuration != null && localDuration >= 100
      ? thoughtForLabel((localDuration / 1000).toFixed(1))
      : doneLabel;

  const textContent = typeof content === "string" ? content : "";
  const summary = useMemo(
    () => extractThinkingSummary(textContent),
    [textContent],
  );

  /**
   * CodePilot ThinkingRow: summary (or Thinking… / Thought) is the trigger.
   * Duration is a fine fallback when we have no extractable gist.
   */
  const triggerLabel = thinking
    ? summary || streamingLabel
    : summary || durationText;

  const hasBody =
    (typeof content === "string" && content.trim().length > 0) ||
    (content != null && typeof content !== "string");

  const toggle = () => {
    setOpen((v) => {
      const next = !v;
      userToggled.current = true;
      // Remember: open after finish → keep-open; close → auto-collapse
      if (!thinking) {
        const p: ThinkingExpandPref = next ? "keep-open" : "auto-collapse";
        saveThinkingExpandPref(p);
        onExpandPrefChange?.(p);
      }
      return next;
    });
  };

  return (
    <div className="lobe-chat-thinking">
      <button
        type="button"
        className="lobe-chat-thinking__trigger"
        aria-expanded={open}
        onClick={toggle}
      >
        <span
          className={cn(
            "lobe-chat-thinking__dot",
            thinking && "lobe-chat-thinking__dot--live",
          )}
        />
        <span
          className={cn(
            "lobe-chat-thinking__label",
            thinking && "lobe-chat-thinking__label--live",
          )}
          style={{ color: "var(--lobe-color-text-secondary)" }}
          title={
            summary && !thinking && durationText !== doneLabel
              ? durationText
              : undefined
          }
        >
          {triggerLabel}
        </span>
        {hasBody ? (
          <IconChevronDown
            size={12}
            className={cn(
              "lobe-chat-thinking__caret text-[var(--lobe-color-text-tertiary)] transition-transform shrink-0 ml-auto",
              open && "rotate-180",
            )}
          />
        ) : null}
      </button>
      {open && hasBody ? (
        <div className="lobe-chat-thinking__body">
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
}
