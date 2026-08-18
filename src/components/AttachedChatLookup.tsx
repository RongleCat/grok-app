/**
 * Title / status / open for [[chat:id]] chips in history bubbles.
 */

import { createContext, useContext } from "react";
import type { ChatAttachStatus } from "@/lib/chatAttach";

export type AttachedChatLookup = {
  titleOf: (sessionId: string) => string;
  statusOf: (sessionId: string) => ChatAttachStatus;
  onOpen?: (sessionId: string) => void;
};

const defaultLookup: AttachedChatLookup = {
  titleOf: (id) => id.slice(0, 8),
  statusOf: () => "ok",
};

export const AttachedChatLookupContext =
  createContext<AttachedChatLookup>(defaultLookup);

export function useAttachedChatLookup(): AttachedChatLookup {
  return useContext(AttachedChatLookupContext);
}
