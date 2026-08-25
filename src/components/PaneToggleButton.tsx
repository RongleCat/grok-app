/**
 * Shared toggle for the left sidebar and right resources pane.
 * Desktop instances stay pinned at the workbench level; phone reuses the
 * same semantics in-flow with `pinned={false}`.
 */
import type { ReactNode } from "react";
import { IconPanel, IconPanelRight } from "@/components/icons";
import { Tip } from "@/components/ui/tooltip";

export type PaneToggleButtonProps = {
  side: "left" | "right";
  open: boolean;
  unread: boolean;
  label: string;
  unreadLabel: string;
  onToggle: () => void;
  pinned?: boolean;
  icon?: ReactNode;
  controlsId?: string;
  className?: string;
  testId?: string;
};

export function PaneToggleButton({
  side,
  open,
  unread,
  label,
  unreadLabel,
  onToggle,
  pinned = true,
  icon,
  controlsId,
  className,
  testId,
}: PaneToggleButtonProps) {
  const showDot = unread && !open;
  const fullLabel = showDot ? `${label} · ${unreadLabel}` : label;

  return (
    <Tip label={fullLabel}>
      <button
        type="button"
        className={
          "chrome-btn main__pane-toggle pane-toggle pane-toggle--" +
          side +
          (pinned ? " pane-toggle--pinned" : "") +
          (open ? " is-on" : "") +
          (className ? " " + className : "")
        }
        aria-label={fullLabel}
        aria-expanded={open}
        aria-controls={controlsId}
        data-testid={testId}
        onClick={onToggle}
      >
        {icon ??
          (side === "left" ? (
            <IconPanel size={16} />
          ) : (
            <IconPanelRight size={16} />
          ))}
        {showDot ? <span className="pane-toggle__dot" aria-hidden /> : null}
      </button>
    </Tip>
  );
}
