/**
 * Collapsed strip for historical assistant turns that were split into
 * multiple intermediate status fragments (grok CLI writes one row per
 * fragment; reconcile may add them individually).
 *
 * Mature-product history folding: the bubble body shows only the final
 * deliverable; earlier fragments ("正在构建…", "检查图片…") are folded here.
 * Per-message local state — expanding one strip never affects others.
 */

import { memo, useMemo, useState } from "react";
import type { Locale } from "@/i18n";
import { createT } from "@/i18n";
import {
  IconChevronDown,
  IconChevronRight,
  IconNotes,
  IconSparkles,
} from "@/components/icons";
import { MarkdownChat } from "./MarkdownChat";

export const LeadFragmentsStrip = memo(function LeadFragmentsStrip({
  fragments,
  locale,
  label,
  testId = "lead-fragments",
  variant = "fragments",
  onOpenExternalLink,
}: {
  fragments: string[];
  locale: Locale;
  /** Override the count label (e.g. a single in-body process diary). */
  label?: string;
  testId?: string;
  variant?: "fragments" | "process";
  onOpenExternalLink?: (url: string) => void;
}) {
  const tr = useMemo(() => createT(locale), [locale]);
  // Local-only toggle (matches per-block Thinking behavior — a user opening
  // one turn's fragments must not open every other turn).
  const [open, setOpen] = useState(false);
  const joined = useMemo(
    () => fragments.filter((f) => f.trim()).join("\n\n"),
    [fragments],
  );
  if (!joined.trim()) return null;

  const chrome =
    label ?? tr("chat.leadFragments", { n: String(fragments.length) });

  return (
    <div
      className={"grok-fragments" + (open ? " is-open" : " is-collapsed")}
      data-testid={testId}
      data-variant={variant}
      data-expanded={open ? "1" : "0"}
    >
      <button
        type="button"
        className="grok-fragments__header"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="grok-fragments__icon" aria-hidden>
          {variant === "process" ? (
            <IconNotes size={14} stroke={1.5} />
          ) : (
            <IconSparkles size={14} stroke={1.5} />
          )}
        </span>
        <span className="grok-fragments__label">{chrome}</span>
        <span className="grok-fragments__caret" aria-hidden>
          {open ? (
            <IconChevronDown size={13} stroke={1.75} />
          ) : (
            <IconChevronRight size={13} stroke={1.75} />
          )}
        </span>
      </button>
      {open ? (
        <div className="grok-fragments__body">
          <MarkdownChat
            locale={locale}
            muted
            pathCards={false}
            onOpenExternalLink={onOpenExternalLink}
          >
            {joined}
          </MarkdownChat>
        </div>
      ) : null}
    </div>
  );
});
