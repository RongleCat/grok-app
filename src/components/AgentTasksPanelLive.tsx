/**
 * Tasks panel bound to sessionTranscriptStore content and liveMap.
 *
 * Keeps AppWorkbench off stream content and liveMap row ticks — only this
 * bridge re-renders while tools/token steps grow. The heavy panel chunk
 * is lazy-loaded the first time the panel opens.
 */

import { lazy, Suspense, useMemo } from "react";
import { useViewingMessages } from "@/hooks/useSessionTranscript";
import { useLiveMap } from "@/hooks/useSessionLiveMap";
import {
  collectActivitySessions,
  type SessionTitleLookup,
} from "@/lib/agentActivity";
import type { AgentTasksPanelProps } from "@/components/AgentTasksPanel";

const AgentTasksPanel = lazy(async () => {
  const m = await import("@/components/AgentTasksPanel");
  return { default: m.AgentTasksPanel };
});

export type AgentTasksPanelLiveProps = Omit<
  AgentTasksPanelProps,
  "messages" | "activitySessions"
> & {
  activityLookupSessions: SessionTitleLookup[];
  currentSessionId?: string | null;
  untitledLabel?: string;
};

export function AgentTasksPanelLive({
  activityLookupSessions,
  currentSessionId,
  untitledLabel,
  ...props
}: AgentTasksPanelLiveProps) {
  const messages = useViewingMessages();
  const liveMap = useLiveMap();
  const activitySessions = useMemo(
    () =>
      collectActivitySessions({
        liveMap,
        sessions: activityLookupSessions,
        currentSessionId,
        untitledLabel,
      }),
    [liveMap, activityLookupSessions, currentSessionId, untitledLabel],
  );
  return (
    <Suspense fallback={null}>
      <AgentTasksPanel
        {...props}
        messages={messages}
        activitySessions={activitySessions}
      />
    </Suspense>
  );
}
