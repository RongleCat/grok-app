/**
 * ConversationThread bound to sessionTranscriptStore.
 * Isolates stream token re-renders from the App shell.
 */

import { memo, useSyncExternalStore } from "react";
import { ConversationThread, type ConversationThreadProps } from "./ConversationThread";
import {
  getChatFindLiveSnapshot,
  subscribeChatFindLive,
} from "@/lib/chatFindLiveStore";
import {
  useTranscriptMeta,
  useViewingMessages,
} from "@/hooks/useSessionTranscript";

function useChatFindLive() {
  return useSyncExternalStore(
    subscribeChatFindLive,
    getChatFindLiveSnapshot,
    getChatFindLiveSnapshot,
  );
}

export type ConversationThreadLiveProps = Omit<
  ConversationThreadProps,
  "messages"
>;

export const ConversationThreadLive = memo(function ConversationThreadLive(
  props: ConversationThreadLiveProps,
) {
  const messages = useViewingMessages();
  const meta = useTranscriptMeta();
  const find = useChatFindLive();
  const journalLoading = !!props.journalLoading || meta.journalLoading;
  return (
    <ConversationThread
      {...props}
      messages={messages}
      journalLoading={journalLoading}
      findQuery={find.query}
      findHitMessageIds={find.hitIds}
      findActive={find.active}
    />
  );
});
