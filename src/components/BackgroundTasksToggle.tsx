/**
 * Chrome toggle for the background-tasks column.
 * Sits with Environment and the terminal toggle in the chat title bar.
 */
import { useMemo } from "react";
import { createT, type Locale } from "@/i18n";
import { IconListCheck } from "@/components/icons";
import { Tip } from "@/components/ui/tooltip";
import {
  toggleBackgroundTasks,
  useBackgroundTasks,
} from "@/lib/backgroundTasksStore";

export type BackgroundTasksToggleProps = {
  locale: Locale | string;
};

export function BackgroundTasksToggle({ locale }: BackgroundTasksToggleProps) {
  const tr = useMemo(() => createT(locale as Locale), [locale]);
  const tasks = useBackgroundTasks();
  const label = tasks.open ? tr("fleet.hide") : tr("fleet.show");
  return (
    <Tip label={label}>
      <button
        type="button"
        className={"chrome-btn main__pane-toggle" + (tasks.open ? " is-on" : "")}
        aria-label={label}
        aria-pressed={tasks.open}
        aria-expanded={tasks.open}
        aria-controls="chat-fleet-pane"
        data-testid="background-tasks-toggle"
        onClick={() => toggleBackgroundTasks()}
      >
        <IconListCheck size={16} />
      </button>
    </Tip>
  );
}
