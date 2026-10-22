/**
 * Poll the linked CLI `updates.jsonl` through the host. The panel replaces
 * task status from each snapshot.
 */
import { useEffect, useState } from "react";
import { invoke, isTauri } from "@/lib/api/host";
import type { TaskBoardRow } from "@/lib/sessionTasks";

const POLL_MS = 2000;

export type TaskBoardSnapshot = {
  tasks: readonly TaskBoardRow[];
  subagents: readonly TaskBoardRow[];
};

const EMPTY: TaskBoardSnapshot = { tasks: [], subagents: [] };

export function useTaskBoard(
  sessionId: string | null | undefined,
): TaskBoardSnapshot {
  const [rows, setRows] = useState<TaskBoardSnapshot>(EMPTY);

  useEffect(() => {
    if (!sessionId || !isTauri()) {
      setRows(EMPTY);
      return;
    }
    let cancelled = false;
    const tick = () => {
      void invoke<TaskBoardSnapshot>("task_board_snapshot", { sessionId })
        .then((next) => {
          if (!cancelled) {
            setRows({
              tasks: next.tasks ?? [],
              subagents: next.subagents ?? [],
            });
          }
        })
        .catch(() => {
          if (!cancelled) setRows(EMPTY);
        });
    };
    tick();
    const timer = window.setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [sessionId]);

  return rows;
}
