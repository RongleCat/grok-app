/**
 * Keep a sidebar tree section mounted through its exit so expand/collapse
 * interpolates height instead of hard-cutting the session list.
 */

import type { ReactNode } from "react";
import { useOpenPresence, OPEN_PRESENCE_MS } from "@/lib/openPresence";

type SidebarTreeRevealProps = {
  open: boolean;
  className?: string;
  children: ReactNode;
};

export function SidebarTreeReveal({
  open,
  className,
  children,
}: SidebarTreeRevealProps) {
  const presence = useOpenPresence(open, true, OPEN_PRESENCE_MS);
  if (!presence.mounted) return null;
  return (
    <div
      className={
        "tree-reveal" +
        (presence.entered ? " is-open" : "") +
        (className ? ` ${className}` : "")
      }
      data-testid="tree-reveal"
      aria-hidden={!presence.entered || undefined}
      inert={!presence.entered || undefined}
    >
      <div className="tree-reveal__inner">{children}</div>
    </div>
  );
}
