/**
 * Composer domain controller (slash / draft / attachments / @ / + panels).
 * Extracted from AppWorkbench; onSend / session boundary stays in workbench.
 *
 * Draft text lives in `composerDraftStore` so keystrokes do not re-render the
 * workbench shell. Consumers use setDraft/getDraft (no draft value in return).
 */
import {
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { Attachment } from "@/lib/attachments";
import type { ComposerAtFileEntry } from "@/components/ComposerAtPanel";
import type { SlashKindFilter, SkillInfo } from "@/lib/slashCatalog";
import type { PromptHistoryScope } from "@/components/PromptHistoryPanel";
import {
  loadRecentPromptHistory,
  type RecentPromptEntry,
} from "@/lib/recentPromptHistory";
import {
  getDraft,
  setDraft as storeSetDraft,
} from "@/lib/composerDraftStore";

export type LiveTokenQuery = {
  present: boolean;
  query: string;
  start: number;
  end: number;
};

export type SlashQueryRange = {
  start: number;
  query: string;
  end: number;
};

const EMPTY_LIVE: LiveTokenQuery = {
  present: false,
  query: "",
  start: 0,
  end: 0,
};

/**
 * Local composer UI state. Send path and Host wiring remain in AppWorkbench.
 * Draft is external-store only — never returned as React state.
 */
export function useComposerController(initialDraft = "") {
  /** Seed store once when a non-empty initial is passed (tests / rare). */
  const seededRef = useRef(false);
  if (!seededRef.current) {
    seededRef.current = true;
    if (initialDraft) storeSetDraft(initialDraft);
  }

  /** Stable store actions (identity never changes). */
  const setDraft = storeSetDraft;

  const [attachments, setAttachments] = useState<Attachment[]>([]);

  /**
   * Skip debounced project-draft persist while programmatically loading a
   * saved buffer into the composer (newChat restore).
   */
  const suppressProjectDraftPersistRef = useRef(false);

  /**
   * CLI-like prompt history browse index (0 = newest user msg).
   * null = not browsing; only engaged when draft empty (or already browsing).
   */
  const [promptHistoryIndex, setPromptHistoryIndex] = useState<number | null>(
    null,
  );
  const promptHistoryIndexRef = useRef<number | null>(null);
  promptHistoryIndexRef.current = promptHistoryIndex;

  /**
   * `/history` + empty-↑ picker — session tab (Build) + cross-session recent.
   */
  const [promptHistoryOpen, setPromptHistoryOpen] = useState(false);
  const [promptHistoryFilter, setPromptHistoryFilter] = useState("");
  const [promptHistoryActive, setPromptHistoryActive] = useState(0);
  const [promptHistoryFocusFilter, setPromptHistoryFocusFilter] =
    useState(false);
  const [promptHistoryScope, setPromptHistoryScope] =
    useState<PromptHistoryScope>("session");
  const promptHistoryScopeRef = useRef<PromptHistoryScope>("session");
  promptHistoryScopeRef.current = promptHistoryScope;
  const [recentPromptHistory, setRecentPromptHistory] = useState<
    RecentPromptEntry[]
  >(() =>
    typeof localStorage !== "undefined" ? loadRecentPromptHistory() : [],
  );
  /** Clear recent prompts — App-level GlassModal (avoids floating-menu dismiss). */
  const [promptHistoryClearOpen, setPromptHistoryClearOpen] = useState(false);
  const promptHistoryPanelRef = useRef<HTMLDivElement>(null);
  const promptHistoryOpenRef = useRef(false);
  promptHistoryOpenRef.current = promptHistoryOpen;

  const [skillInfos, setSkillInfos] = useState<SkillInfo[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(false);
  /** Host `skills_list` error (CLI missing / inspect fail); empty when ok. */
  const [skillsLoadError, setSkillsLoadError] = useState<string | null>(null);

  const [slashQuery, setSlashQuery] = useState<SlashQueryRange | null>(null);
  /**
   * Live slash token from contenteditable.innerText (rAF poll).
   * Independent of React draft so IME / <br> / missed onChange cannot desync.
   */
  const [liveSlash, setLiveSlash] = useState<LiveTokenQuery>(EMPTY_LIVE);
  const liveSlashRef = useRef(liveSlash);
  liveSlashRef.current = liveSlash;
  /** After Escape, suppress re-open until the `/token` text changes. */
  const slashDismissedSigRef = useRef<string | null>(null);
  const showComposerPlusRef = useRef(false);
  const [slashActiveIndex, setSlashActiveIndex] = useState(0);
  /** Kind chip for slash / + palette (`all` | mode | action | prompt | skill). */
  const [slashKindFilter, setSlashKindFilter] =
    useState<SlashKindFilter>("all");

  /**
   * Live `@` file token (rAF, same source as slash).
   * Suppressed while slash/plus menu is open (slash wins).
   */
  const [liveAt, setLiveAt] = useState<LiveTokenQuery>(EMPTY_LIVE);
  const liveAtRef = useRef(liveAt);
  liveAtRef.current = liveAt;
  const atDismissedSigRef = useRef<string | null>(null);
  const [atActiveIndex, setAtActiveIndex] = useState(0);
  const [atEntries, setAtEntries] = useState<ComposerAtFileEntry[]>([]);
  const [atLoading, setAtLoading] = useState(false);
  const [atSoftFail, setAtSoftFail] = useState<string | null>(null);
  const atPanelRef = useRef<HTMLDivElement>(null);
  const atSearchGenRef = useRef(0);

  const [showComposerPlus, setShowComposerPlus] = useState(false);
  showComposerPlusRef.current = showComposerPlus;
  const composerPlusTriggerRef = useRef<HTMLButtonElement>(null);
  const composerPlusPanelRef = useRef<HTMLDivElement>(null);
  const composerInputRef = useRef<HTMLDivElement>(null);
  /** Actual input card (.composer) — command panel anchors here. */
  const composerShellRef = useRef<HTMLDivElement>(null);
  /** Floating composer shell — height drives chat bottom padding. */
  const [composerFloatPad, setComposerFloatPad] = useState(168);

  return useMemo(
    () => ({
      /** Call-time read; does not subscribe (safe in event handlers / send). */
      getDraft,
      setDraft,
      attachments,
      setAttachments: setAttachments as Dispatch<
        SetStateAction<Attachment[]>
      >,
      suppressProjectDraftPersistRef,
      promptHistoryIndex,
      setPromptHistoryIndex,
      promptHistoryIndexRef,
      promptHistoryOpen,
      setPromptHistoryOpen,
      promptHistoryFilter,
      setPromptHistoryFilter,
      promptHistoryActive,
      setPromptHistoryActive,
      promptHistoryFocusFilter,
      setPromptHistoryFocusFilter,
      promptHistoryScope,
      setPromptHistoryScope,
      promptHistoryScopeRef,
      recentPromptHistory,
      setRecentPromptHistory,
      promptHistoryClearOpen,
      setPromptHistoryClearOpen,
      promptHistoryPanelRef,
      promptHistoryOpenRef,
      skillInfos,
      setSkillInfos,
      skillsLoading,
      setSkillsLoading,
      skillsLoadError,
      setSkillsLoadError,
      slashQuery,
      setSlashQuery,
      liveSlash,
      setLiveSlash,
      liveSlashRef,
      slashDismissedSigRef,
      showComposerPlusRef,
      slashActiveIndex,
      setSlashActiveIndex,
      slashKindFilter,
      setSlashKindFilter,
      liveAt,
      setLiveAt,
      liveAtRef,
      atDismissedSigRef,
      atActiveIndex,
      setAtActiveIndex,
      atEntries,
      setAtEntries,
      atLoading,
      setAtLoading,
      atSoftFail,
      setAtSoftFail,
      atPanelRef,
      atSearchGenRef,
      showComposerPlus,
      setShowComposerPlus,
      composerPlusTriggerRef,
      composerPlusPanelRef,
      composerInputRef,
      composerShellRef,
      composerFloatPad,
      setComposerFloatPad,
      // Legacy alias names used by earlier stub consumers
      slashOpen: showComposerPlus || liveSlash.present || !!slashQuery,
      setSlashOpen: setShowComposerPlus,
      atOpen: liveAt.present,
      setAtOpen: (_v: boolean) => {
        if (!_v) {
          setLiveAt(EMPTY_LIVE);
        }
      },
      plusOpen: showComposerPlus,
      setPlusOpen: setShowComposerPlus,
    }),
    [
      attachments,
      promptHistoryIndex,
      promptHistoryOpen,
      promptHistoryFilter,
      promptHistoryActive,
      promptHistoryFocusFilter,
      promptHistoryScope,
      recentPromptHistory,
      promptHistoryClearOpen,
      skillInfos,
      skillsLoading,
      skillsLoadError,
      slashQuery,
      liveSlash,
      slashActiveIndex,
      slashKindFilter,
      liveAt,
      atActiveIndex,
      atEntries,
      atLoading,
      atSoftFail,
      showComposerPlus,
      composerFloatPad,
    ],
  );
}
