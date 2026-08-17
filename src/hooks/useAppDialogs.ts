/**
 * Central in-app dialog host state (WP-B5 + residual-appworkbench).
 * Never uses window.confirm / alert / prompt.
 *
 * Owns: appDialog confirm/prompt, dialog input/focus trap wiring, and
 * clustered session note / rules / max-turns / sys-prompt / rewind / fork
 * modal open-state (Host API handlers stay in AppWorkbench).
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { installDialogFocus } from "@/lib/a11yFocus";
import type { AppDialog } from "@/lib/app/appDialogTypes";
import type { SessionRow } from "@/lib/app/sidebarModels";
import {
  loadSessionNotes,
  SESSION_NOTES_CHANGE_EVENT,
} from "@/lib/sessionNotes";

export type { AppDialog };

export type SessionNoteTarget = {
  id: string;
  title: string;
};

export type SessionRulesTarget = {
  id: string;
  title: string;
};

export type SessionMaxTurnsTarget = {
  id: string;
  title: string;
};

export type SessionSysPromptTarget = {
  id: string;
  title: string;
};

export type RewindTimelineState = {
  sessionId: string;
  points: Array<{
    promptIndex: number;
    messageId?: string | null;
    preview: string;
  }>;
};

export type RewindConfirmState = {
  sessionId: string;
  targetPromptIndex: number;
  preview?: string;
};

export type ForkConfirmState = {
  source: SessionRow;
  throughUserPromptIndex?: number | null;
};

export function useAppDialogs() {
  const [appDialog, setAppDialog] = useState<AppDialog>(null);
  const [dialogInput, setDialogInput] = useState("");
  const [dialogError, setDialogError] = useState("");
  const dialogInputRef = useRef<HTMLInputElement>(null);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);
  const appDialogPanelRef = useRef<HTMLDivElement>(null);
  /** Latest dialog for Enter/Escape handlers (avoids stale chained confirms). */
  const appDialogRef = useRef<AppDialog>(null);
  appDialogRef.current = appDialog;

  /** Dismiss without confirm/submit — invoke optional onDismiss first. */
  const dismissDialog = useCallback(() => {
    const d = appDialogRef.current;
    setAppDialog(null);
    if (d && "onDismiss" in d && typeof d.onDismiss === "function") {
      try {
        d.onDismiss();
      } catch {
        /* ignore dismiss errors */
      }
    }
  }, []);
  const closeDialog = dismissDialog;
  const openDialog = useCallback(
    (d: NonNullable<AppDialog>) => setAppDialog(d),
    [],
  );

  useEffect(() => {
    if (!appDialog) return;
    if (appDialog.kind === "prompt") {
      setDialogInput(appDialog.initial);
      setDialogError("");
      const t = window.setTimeout(() => {
        dialogInputRef.current?.focus();
        dialogInputRef.current?.select();
      }, 0);
      return () => window.clearTimeout(t);
    }
    // Confirm: focus primary action so keyboard users land on Confirm.
    // Enter is also handled globally below so it still confirms if focus
    // sits on Cancel / close (needed for multi-step YOLO Enter spam).
    if (appDialog.kind === "confirm") {
      const t = window.setTimeout(() => {
        confirmBtnRef.current?.focus();
      }, 0);
      return () => window.clearTimeout(t);
    }
  }, [appDialog]);

  // appDialog: Tab focus trap + Escape dismiss + restore previous focus.
  // Enter-confirm stays in a separate capture handler below.
  useEffect(() => {
    if (!appDialog) return;
    return installDialogFocus(() => appDialogPanelRef.current, {
      onEscape: () => dismissDialog(),
      capture: true,
      // Initial focus handled by the prompt/confirm effect above.
      initialFocus: "none",
      restoreFocus: true,
    });
  }, [appDialog, dismissDialog]);

  useEffect(() => {
    if (!appDialog) return;
    const onKey = (e: KeyboardEvent) => {
      // Confirm dialogs: Enter always accepts (including chained YOLO steps).
      // Capture phase + preventDefault so we don't double-fire with a focused
      // submit button's native activation. Escape is handled by installDialogFocus.
      if (e.key !== "Enter" && e.key !== "NumpadEnter") return;
      if (e.isComposing || e.altKey || e.ctrlKey || e.metaKey) return;
      const dialog = appDialogRef.current;
      if (!dialog || dialog.kind !== "confirm") return;
      e.preventDefault();
      e.stopPropagation();
      const run = dialog.onConfirm;
      setAppDialog(null);
      void run();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [appDialog]);

  // --- Session sticky notes (localStorage map; never sent to agent) ---
  const [sessionNotesMap, setSessionNotesMap] = useState<
    Record<string, string>
  >(() => loadSessionNotes());
  useEffect(() => {
    const onChange = () => setSessionNotesMap(loadSessionNotes());
    window.addEventListener(SESSION_NOTES_CHANGE_EVENT, onChange);
    return () =>
      window.removeEventListener(SESSION_NOTES_CHANGE_EVENT, onChange);
  }, []);
  const [sessionNoteTarget, setSessionNoteTarget] =
    useState<SessionNoteTarget | null>(null);
  const [sessionNoteDraft, setSessionNoteDraft] = useState("");
  const [sessionNoteBaseline, setSessionNoteBaseline] = useState("");
  const [sessionNoteDiscardOpen, setSessionNoteDiscardOpen] = useState(false);
  const [sessionNoteClearOpen, setSessionNoteClearOpen] = useState(false);

  // --- Per-session extra rules editor (`--rules`) ---
  const [sessionRulesTarget, setSessionRulesTarget] =
    useState<SessionRulesTarget | null>(null);
  const [sessionRulesDraft, setSessionRulesDraft] = useState("");
  const [sessionRulesBaseline, setSessionRulesBaseline] = useState("");
  const [sessionRulesBusy, setSessionRulesBusy] = useState(false);
  const [sessionRulesError, setSessionRulesError] = useState<string | null>(
    null,
  );
  const [sessionRulesDiscardOpen, setSessionRulesDiscardOpen] = useState(false);

  // --- Per-session max agent turns editor (`--max-turns`) ---
  const [sessionMaxTurnsTarget, setSessionMaxTurnsTarget] =
    useState<SessionMaxTurnsTarget | null>(null);
  /** Draft as string so empty input means inherit global. */
  const [sessionMaxTurnsDraft, setSessionMaxTurnsDraft] = useState("");

  // --- Per-session system prompt override editor ---
  const [sessionSysPromptTarget, setSessionSysPromptTarget] =
    useState<SessionSysPromptTarget | null>(null);
  const [sessionSysPromptDraft, setSessionSysPromptDraft] = useState("");
  const [sessionSysPromptBaseline, setSessionSysPromptBaseline] = useState("");
  const [sessionSysPromptBusy, setSessionSysPromptBusy] = useState(false);
  const [sessionSysPromptError, setSessionSysPromptError] = useState<
    string | null
  >(null);
  const [sessionSysPromptDiscardOpen, setSessionSysPromptDiscardOpen] =
    useState(false);

  // --- Rewind timeline / confirm ---
  const [rewindTimeline, setRewindTimeline] =
    useState<RewindTimelineState | null>(null);
  const [rewindBusy, setRewindBusy] = useState(false);
  const [rewindConfirm, setRewindConfirm] =
    useState<RewindConfirmState | null>(null);
  const [rewindRestoreFiles, setRewindRestoreFiles] = useState(false);
  const rewindModalRef = useRef<HTMLDivElement>(null);

  // Rewind timeline dialog — focus trap + Escape.
  useEffect(() => {
    if (!rewindTimeline) return;
    return installDialogFocus(() => rewindModalRef.current, {
      onEscape: () => {
        if (!rewindBusy) setRewindTimeline(null);
      },
      capture: true,
      initialFocus: "first",
      restoreFocus: true,
    });
  }, [rewindTimeline, rewindBusy]);

  // --- Fork / resume-restore confirm ---
  const [forkConfirm, setForkConfirm] = useState<ForkConfirmState | null>(
    null,
  );
  const [forkRestoreCode, setForkRestoreCode] = useState(false);
  /** CLI `--fork-session`: new agent session id with parent context. */
  const [forkCliSession, setForkCliSession] = useState(false);
  const [forkBusy, setForkBusy] = useState(false);
  /** Resume existing chat on a clean worktree (restore-code). */
  const [resumeRestoreConfirm, setResumeRestoreConfirm] =
    useState<SessionRow | null>(null);
  const [resumeForkCliSession, setResumeForkCliSession] = useState(false);
  const [resumeRestoreBusy, setResumeRestoreBusy] = useState(false);

  return {
    appDialog,
    setAppDialog: setAppDialog as Dispatch<SetStateAction<AppDialog>>,
    closeDialog,
    dismissDialog,
    openDialog,
    dialogInput,
    setDialogInput,
    dialogError,
    setDialogError,
    dialogInputRef,
    confirmBtnRef,
    appDialogPanelRef,
    appDialogRef: appDialogRef as MutableRefObject<AppDialog>,

    sessionNotesMap,
    setSessionNotesMap,
    sessionNoteTarget,
    setSessionNoteTarget,
    sessionNoteDraft,
    setSessionNoteDraft,
    sessionNoteBaseline,
    setSessionNoteBaseline,
    sessionNoteDiscardOpen,
    setSessionNoteDiscardOpen,
    sessionNoteClearOpen,
    setSessionNoteClearOpen,

    sessionRulesTarget,
    setSessionRulesTarget,
    sessionRulesDraft,
    setSessionRulesDraft,
    sessionRulesBaseline,
    setSessionRulesBaseline,
    sessionRulesBusy,
    setSessionRulesBusy,
    sessionRulesError,
    setSessionRulesError,
    sessionRulesDiscardOpen,
    setSessionRulesDiscardOpen,

    sessionMaxTurnsTarget,
    setSessionMaxTurnsTarget,
    sessionMaxTurnsDraft,
    setSessionMaxTurnsDraft,

    sessionSysPromptTarget,
    setSessionSysPromptTarget,
    sessionSysPromptDraft,
    setSessionSysPromptDraft,
    sessionSysPromptBaseline,
    setSessionSysPromptBaseline,
    sessionSysPromptBusy,
    setSessionSysPromptBusy,
    sessionSysPromptError,
    setSessionSysPromptError,
    sessionSysPromptDiscardOpen,
    setSessionSysPromptDiscardOpen,

    rewindTimeline,
    setRewindTimeline,
    rewindBusy,
    setRewindBusy,
    rewindConfirm,
    setRewindConfirm,
    rewindRestoreFiles,
    setRewindRestoreFiles,
    rewindModalRef,

    forkConfirm,
    setForkConfirm,
    forkRestoreCode,
    setForkRestoreCode,
    forkCliSession,
    setForkCliSession,
    forkBusy,
    setForkBusy,
    resumeRestoreConfirm,
    setResumeRestoreConfirm,
    resumeForkCliSession,
    setResumeForkCliSession,
    resumeRestoreBusy,
    setResumeRestoreBusy,
  };
}
