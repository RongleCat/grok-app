/**
 * Import Grok Build call-log rows into App sidebar chats.
 */
import { useCallback, useState } from "react";
import * as api from "@/lib/api";
import type { CallLogEntry } from "@/lib/api";
import {
  planCallLogImport,
  runCallLogImport,
  shouldShowSidebarCliImportCta,
} from "@/lib/cliSessionCallLogImport";

export function useCliCallLogImport(opts: {
  callLogs: CallLogEntry[] | null | undefined;
  unarchivedAppSessionCount: number;
  linkedAgentIds?: ReadonlySet<string> | readonly string[] | null;
  onImported?: () => void;
}) {
  const [importing, setImporting] = useState(false);
  const showCta = shouldShowSidebarCliImportCta({
    unarchivedAppSessionCount: opts.unarchivedAppSessionCount,
    callLogCount: opts.callLogs?.length ?? 0,
  });
  const callLogs = opts.callLogs;
  const linkedAgentIds = opts.linkedAgentIds;
  const onImported = opts.onImported;

  const importListed = useCallback(async () => {
    if (!api.isTauri() || importing) {
      return { imported: [] as Array<{ id: string }>, failed: 0 };
    }
    const plan = planCallLogImport(callLogs ?? [], linkedAgentIds);
    if (!plan.hasImportable) {
      return { imported: [] as Array<{ id: string }>, failed: 0 };
    }
    setImporting(true);
    try {
      const result = await runCallLogImport(plan, (id) =>
        api.cliSessionImport(id),
      );
      onImported?.();
      return result;
    } finally {
      setImporting(false);
    }
  }, [callLogs, importing, linkedAgentIds, onImported]);

  return { importing, importListed, showCta };
}
