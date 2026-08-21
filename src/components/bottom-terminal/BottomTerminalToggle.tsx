/**
 * Chrome toggle for the bottom PTY panel.
 * Kept out of BottomTerminal.tsx so xterm is not on the startup graph.
 */

import { useMemo } from "react";
import { createT, type Locale } from "@/i18n";
import { IconTerminal } from "@/components/icons";
import { Tip } from "@/components/ui/tooltip";

export type BottomTerminalToggleProps = {
  locale: Locale | string;
  open: boolean;
  onToggle: () => void;
};

export function BottomTerminalToggle({
  locale,
  open,
  onToggle,
}: BottomTerminalToggleProps) {
  const tr = useMemo(() => createT(locale as Locale), [locale]);
  const label = open ? tr("terminal.toggleHide") : tr("terminal.toggleShow");
  return (
    <Tip label={label}>
      <button
        type="button"
        className={"chrome-btn main__pane-toggle" + (open ? " is-on" : "")}
        aria-label={label}
        aria-pressed={open}
        data-testid="bottom-terminal-toggle"
        onClick={onToggle}
      >
        <IconTerminal size={16} />
      </button>
    </Tip>
  );
}
