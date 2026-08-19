/**
 * Capture-phase type-to-focus: printable keys outside inputs land in composer.
 */

import { useEffect, useRef } from "react";
import { querySidebarEl } from "@/lib/dragZone";
import { isShortcutRecordingActive } from "@/lib/shortcutRemap";
import {
  applyTypeToFocusComposer,
  decideTypeToFocusComposer,
  isActivateKeyControl,
  isComposerRedirectBlocked,
  isSidebarSessionNavKey,
} from "@/lib/typeToFocusComposer";

export type TypeToFocusLive = {
  enabled: boolean;
  overlayOpen: boolean;
};

export function useTypeToFocusComposer(opts: {
  getEditor: () => HTMLDivElement | null;
  getLive: () => TypeToFocusLive;
}): void {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const editor = optsRef.current.getEditor();
      if (!editor || editor.getAttribute("contenteditable") === "false") {
        return;
      }
      const live = optsRef.current.getLive();
      const target = e.target as HTMLElement | null;
      const sidebar = querySidebarEl();
      const sidebarOwns =
        !!sidebar && !!target && sidebar.contains(target);
      const decision = decideTypeToFocusComposer(
        {
          key: e.key,
          keyCode: e.keyCode,
          ctrlKey: e.ctrlKey,
          metaKey: e.metaKey,
          altKey: e.altKey,
          isComposing: e.isComposing,
        },
        {
          enabled: live.enabled,
          overlayOpen: live.overlayOpen,
          recordingShortcut: isShortcutRecordingActive(),
          blockedSurface: isComposerRedirectBlocked(target),
          sidebarNavOwnsKey:
            sidebarOwns && isSidebarSessionNavKey(e.key),
          spaceActivatesControl:
            e.key === " " && isActivateKeyControl(target),
        },
      );
      if (decision.action === "ignore") return;
      if (decision.preventDefault) e.preventDefault();
      applyTypeToFocusComposer(editor, decision);
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, []);
}
