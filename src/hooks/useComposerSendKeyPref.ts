/**
 * Live composer send-key preference (Enter vs ⌘/Ctrl+Enter).
 * Settings and the quote comment box share this value.
 */

import { useEffect, useState } from "react";
import {
  COMPOSER_SEND_KEY_CHANGED_EVENT,
  loadComposerSendKeyPref,
  type ComposerSendKeyPref,
} from "@/lib/composerSendKey";

export function useComposerSendKeyPref(): ComposerSendKeyPref {
  const [pref, setPref] = useState<ComposerSendKeyPref>(() =>
    typeof localStorage === "undefined" ? "enter" : loadComposerSendKeyPref(),
  );
  useEffect(() => {
    const sync = () => setPref(loadComposerSendKeyPref());
    window.addEventListener(COMPOSER_SEND_KEY_CHANGED_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(COMPOSER_SEND_KEY_CHANGED_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return pref;
}
