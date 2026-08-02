/**
 * Sidebar session relative-time label.
 * Owns its own 60s tick subscription so App stream re-renders and the
 * shared interval do not force every session row through App state.
 */

import { memo, useSyncExternalStore } from "react";
import { formatMessageTime, formatRelativeTime } from "@/lib/accountUi";
import type { Locale } from "@/i18n";
import {
  getRelativeTimeTick,
  getRelativeTimeTickServerSnapshot,
  subscribeRelativeTimeTick,
  subscribeRelativeTimeTickNoop,
} from "@/lib/relativeTimeTickStore";

export type SidebarSessionRelativeTimeProps = {
  updatedAt: string | undefined;
  locale: Locale;
  /** Mirrors settings `sidebarShowRelativeTime`. */
  enabled: boolean;
};

function SidebarSessionRelativeTimeInner({
  updatedAt,
  locale,
  enabled,
}: SidebarSessionRelativeTimeProps) {
  const active = enabled && !!updatedAt;
  // Always call the hook; only subscribe when the label is shown.
  useSyncExternalStore(
    active ? subscribeRelativeTimeTick : subscribeRelativeTimeTickNoop,
    getRelativeTimeTick,
    getRelativeTimeTickServerSnapshot,
  );

  if (!active || !updatedAt) return null;

  const label = formatRelativeTime(updatedAt, locale);
  if (!label || label === "—") return null;
  const absolute = formatMessageTime(updatedAt, locale);
  return (
    <span className="tree-l3__time" title={absolute || undefined}>
      {label}
    </span>
  );
}

export const SidebarSessionRelativeTime = memo(SidebarSessionRelativeTimeInner);
