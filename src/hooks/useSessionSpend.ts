import { useEffect, useState } from "react";
import {
  getSessionSpend,
  subscribeSessionSpend,
  type SessionSpend,
} from "@/lib/sessionSpend";

/** Live view of process-scoped session billing spend. */
export function useSessionSpend(
  sessionId: string | null | undefined,
): SessionSpend {
  const [spend, setSpend] = useState(() => getSessionSpend(sessionId));
  useEffect(() => {
    setSpend(getSessionSpend(sessionId));
    return subscribeSessionSpend((id) => {
      if (!sessionId || id === sessionId) {
        setSpend(getSessionSpend(sessionId));
      }
    });
  }, [sessionId]);
  return spend;
}
