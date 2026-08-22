/**
 * In-chat find island — query, matches, and stream ticks stay off the shell.
 */

import { useEffect, useMemo, useState } from "react";
import { ChatFindBar, type ChatFindBarLabels } from "@/components/ChatFindBar";
import {
  findChatMatches,
  stepChatFindIndex,
  type ChatFindMessage,
} from "@/lib/chatFind";
import {
  publishChatFindLive,
  resetChatFindLive,
} from "@/lib/chatFindLiveStore";
import { sessionTranscriptStore } from "@/lib/sessionTranscriptStore";

export function ChatFindLive({
  labels,
  focusNonce,
  onClose,
}: {
  labels: ChatFindBarLabels;
  focusNonce: number;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const [liveTick, setLiveTick] = useState(0);

  useEffect(() => {
    let raf = 0;
    const unsub = sessionTranscriptStore.subscribeContent(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setLiveTick((n) => n + 1));
    });
    return () => {
      cancelAnimationFrame(raf);
      unsub();
    };
  }, []);

  const matches = useMemo(() => {
    void liveTick;
    const live = sessionTranscriptStore.getMessages();
    const rows: ChatFindMessage[] = [];
    for (const m of live) {
      if (m.role !== "user" && m.role !== "assistant") continue;
      rows.push({
        id: m.id,
        role: m.role,
        content: m.content,
        marker: m.marker,
      });
    }
    return findChatMatches(query, rows);
  }, [query, liveTick]);

  const clamped =
    matches.length === 0
      ? 0
      : index >= 0 && index < matches.length
        ? index
        : 0;

  useEffect(() => {
    if (clamped !== index) setIndex(clamped);
  }, [clamped, index]);

  useEffect(() => {
    publishChatFindLive({ query, index: clamped, matches });
  }, [query, clamped, matches]);

  useEffect(() => {
    return () => {
      resetChatFindLive();
    };
  }, []);

  return (
    <ChatFindBar
      focusNonce={focusNonce}
      query={query}
      activeIndex={clamped}
      matchCount={matches.length}
      labels={labels}
      onQueryChange={(q) => {
        setQuery(q);
        setIndex(0);
      }}
      onPrev={() =>
        setIndex((i) => stepChatFindIndex(i, matches.length, -1))
      }
      onNext={() =>
        setIndex((i) => stepChatFindIndex(i, matches.length, 1))
      }
      onClose={onClose}
    />
  );
}
