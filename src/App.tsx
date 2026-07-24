import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { createPortal } from "react-dom";
import { useFloatingMenu } from "@/lib/floatingMenu";
import {
  applyNativeWindowTheme,
  applyThemeToDocument,
  loadTheme,
  saveTheme,
  toggleTheme,
  type Theme,
} from "@/lib/theme";
import {
  DEFAULT_LAYOUT,
  clampAsideWidth,
  loadLayout,
  saveLayout,
} from "@/lib/layout";
import {
  hitDragZoneFromRects,
  querySidebarEl,
  toClientDragPoint,
} from "@/lib/dragZone";
import {
  applyContextCompact,
  applyGeneratedImage,
  applyStreamChunk,
  applyToolEvent,
  applyTurnError,
  applyTurnMarker,
  parseCompactContent,
  parseToolStepContent,
  canSend,
  canStop,
  canType,
  clearPriorTurnStreaming,
  isSessionBusy,
  isSessionLiveStreaming,
  preferSessionMessages,
  presentErrorBanner,
  buildSegmentsFromLegacy,
  splitThoughtPhases,
  truncateBeforeLastUser,
  truncateThroughUserPrompt,
  canRewindToUserPrompt,
  userPromptIndexOf,
  localRewindPoints,
  IDLE_SNAPSHOT,
  type AskUserPayload,
  type ChatMessage,
  type GeneratedImagePayload,
  type PermissionPayload,
  type SessionSnapshot,
  type StreamPayload,
  type TurnErrorPayload,
} from "@/lib/session";
import {
  INITIAL_CONTEXT_USAGE,
  reduceContextUsage,
  resolveContextUsageDisplay,
  type ContextUsageState,
} from "@/lib/contextUsage";
import { ContextUsageChip } from "@/components/ContextUsageChip";
import * as api from "@/lib/api";
import { createT, resolveLocale, type Locale } from "@/i18n";
import {
  DEFAULT_EFFORT,
  DEFAULT_MODEL_ID,
  GROK_BUILD_MODELS,
  isValidEffort,
  isValidModelId,
  isValidPolicy,
  isValidPrefsScope,
  pickDefaultModelId,
  type ComposerPrefsScope,
  type ModelOption,
  type PermissionPolicyId,
} from "@/lib/grokCatalog";
import {
  formatPermissionSummary,
  mapPermissionButtons,
} from "@/lib/permissionOptions";
import { AskUserModal } from "@/components/AskUserModal";
import { DoctorModal } from "@/components/DoctorModal";
import { filterSessionSearch } from "@/lib/sessionSearch";
import {
  sessionExportFilename,
  sessionToMarkdown,
} from "@/lib/sessionExport";
import { connPillForState } from "@/lib/connStatus";
import { shortcutsForPlatform } from "@/lib/shortcuts";
import {
  ensureNotifyPermission,
  showDesktopNotification,
} from "@/lib/desktopNotify";
import { GlassModal } from "@/components/GlassModal";
import {
  applyResolvedSessionMedia,
  buildAgentPrompt,
  collectSessionRelativeMediaRefs,
  isImagePath,
  mergeAttachments,
  mergeMessageAttachments,
  parseAttachmentsFromContent,
  type Attachment,
} from "@/lib/attachments";
import {
  applySkillAtSlash,
  isDraftEmpty,
  hydrateDisplayContent,
  detectSlashQueryFromEditor,
  parseStoredContent,
  serializeForAgent,
} from "@/lib/draftDoc";
import {
  buildSlashCatalog,
  flattenFilteredCatalog,
  type SlashItem,
  type SkillInfo,
} from "@/lib/slashCatalog";
import type { MessageKey } from "@/i18n";
import { AttachmentCard } from "@/components/AttachmentCard";
import { ImageViewerProvider } from "@/components/ImageViewer";
import { OverlayScroll } from "@/components/OverlayScroll";
import { GrokLogo } from "@/components/GrokLogo";
import { SetupWizard, type SetupCliInfo } from "@/components/SetupWizard";
import { ComposerEditor } from "@/components/ComposerEditor";
import { ComposerProjectMenu } from "@/components/ComposerProjectMenu";
import {
  ComposerPlusPanel,
  buildComposerPlusEntries,
  uploadMatchesQuery,
} from "@/components/ComposerPlusPanel";
import { StatusModal } from "@/components/StatusModal";
import { McpStatusModal } from "@/components/McpStatusModal";
import {
  IconChevronDown,
  IconChevronRight,
  IconMore,
  IconPlus,
  IconSearch,
  IconAttach,
  IconSend,
  IconStop,
  IconFolder,
  IconFolderPlus,
  IconClock,
  IconClose,
  IconNewChat as IconSquarePen,
  IconNewChat,
  IconImagine,
  IconScheduled,
  IconPanel,
  IconPanelRight,
  IconArchive,
  IconPin,
  IconPinOff,
  IconRename,
  IconCopy,
  IconTrash,
  IconExternalLink,
  IconFork,
  IconRewind,
} from "@/components/icons";
import { AutomationsPage } from "@/components/AutomationsPage";
import { OpenLocationButton } from "@/components/OpenLocationButton";
import { ContextMenu, type ContextMenuItem } from "@/components/ContextMenu";
import {
  aiCreateSeedPrompt,
  computeNextRunAt,
  isDue,
  parseScheduledUserContent,
  type Automation,
} from "@/lib/automations";
import {
  extractAutomationPayload,
  looksLikeScheduleIntent,
  wrapAutomationSetupAgentText,
} from "@/lib/automationSetup";
import {
  ComposerAccessMenu,
  ComposerModelMenu,
} from "@/components/ComposerModelMenu";
import {
  ResourceViewer,
  type ResourceOpenTarget,
} from "@/components/ResourceViewer";
import {
  mergeSessionChange,
  sessionChangesFromMessages,
  type SessionFileChange,
} from "@/lib/sessionChanges";
import { ConversationThread } from "@/components/lobe-chat";
import { Spinner } from "@/components/ui/spinner";
import { UserMenu, remainingPercent } from "@/components/UserMenu";
import {
  SettingsPage,
  type SettingsSectionId,
} from "@/components/SettingsPage";
import {
  accountDisplayName,
  accountInitials,
  isAccountConnected,
  loadCachedSuperGrokBrand,
  resolveWelcomeBrandKind,
  saveCachedSuperGrokBrand,
  superGrokBrandKind,
} from "@/lib/accountUi";
import {
  SuperGrokMark,
  type SuperGrokBrandKind,
} from "@/components/SuperGrokMark";
import { Tip } from "@/components/ui/tooltip";
import {
  WindowControls,
  toggleMaximizeFromTitlebar,
} from "@/components/WindowControls";

interface Project {
  id: string;
  name: string;
  path: string;
  trusted: boolean;
  pathOk: boolean;
  pinned?: boolean;
}

interface SessionRow {
  id: string;
  title: string;
  projectId: string | null;
  updatedAt: string;
  archived?: boolean;
  /** Shell scheduled-automation run */
  scheduled?: boolean;
}

type ContextMenuState =
  | { kind: "project"; id: string; x: number; y: number }
  | { kind: "session"; id: string; x: number; y: number }
  | null;

/** In-app dialogs — window.prompt/confirm are unreliable in Tauri WebView. */
type AppDialog =
  | {
      kind: "confirm";
      title: string;
      message: string;
      confirmLabel?: string;
      danger?: boolean;
      onConfirm: () => void | Promise<void>;
    }
  | {
      kind: "prompt";
      title: string;
      initial: string;
      placeholder?: string;
      onSubmit: (value: string) => void | Promise<void>;
    }
  | null;

interface PlanState {
  title: string;
  body: string;
  entries: unknown[];
  waiting: boolean;
  /** Pending exit_plan_mode JSON-RPC id */
  rpcId?: number | null;
  toolCallId?: string | null;
}

export default function App() {
  const [theme, setTheme] = useState<Theme>(() => loadTheme(localStorage));
  const [layout, setLayout] = useState(() => loadLayout(localStorage));
  const [session, setSession] = useState<SessionSnapshot>(IDLE_SNAPSHOT);
  /** Host live agent (may differ from the session currently viewed in the UI). */
  const [liveHost, setLiveHost] = useState<SessionSnapshot>(IDLE_SNAPSHOT);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  /** Context usage chip — known tokens from compact events + estimate fallback. */
  const [contextUsage, setContextUsage] = useState<ContextUsageState>(
    INITIAL_CONTEXT_USAGE,
  );
  /**
   * Files written/edited by agent tools per session (Changes / diff panel).
   * Live tool events may enrich entries with before/after snippets.
   */
  const [sessionChangesById, setSessionChangesById] = useState<
    Record<string, SessionFileChange[]>
  >({});
  /** Composer stored form (may include [[skill:name]] tokens). */
  const [draft, setDraft] = useState("");
  const [goalMode, setGoalMode] = useState(false);
  const [skillInfos, setSkillInfos] = useState<SkillInfo[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [slashQuery, setSlashQuery] = useState<{
    start: number;
    query: string;
    end: number;
  } | null>(null);
  /**
   * Live slash token from contenteditable.innerText (rAF poll).
   * Independent of React draft so IME / <br> / missed onChange cannot desync.
   * `present` is true for bare `/` as well as `/query`.
   */
  const [liveSlash, setLiveSlash] = useState<{
    present: boolean;
    query: string;
    start: number;
    end: number;
  }>({ present: false, query: "", start: 0, end: 0 });
  const liveSlashRef = useRef(liveSlash);
  liveSlashRef.current = liveSlash;
  /** After Escape, suppress re-open until the `/token` text changes. */
  const slashDismissedSigRef = useRef<string | null>(null);
  const showComposerPlusRef = useRef(false);
  const [slashActiveIndex, setSlashActiveIndex] = useState(0);
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [showMcpModal, setShowMcpModal] = useState(false);
  const [mcpServers, setMcpServers] = useState<api.McpDto[]>([]);
  const [mcpError, setMcpError] = useState<string | null>(null);
  const [mcpLoading, setMcpLoading] = useState(false);
  const [showCompactModal, setShowCompactModal] = useState(false);
  const [compactNote, setCompactNote] = useState("");
  const compactNoteRef = useRef<HTMLInputElement>(null);
  /** Rewind timeline picker (session menu / status). */
  const [rewindTimeline, setRewindTimeline] = useState<{
    sessionId: string;
    points: Array<{ promptIndex: number; messageId?: string | null; preview: string }>;
  } | null>(null);
  const [rewindBusy, setRewindBusy] = useState(false);
  /** Last user message open in inline edit (not main composer). */
  const [editingUserMessageId, setEditingUserMessageId] = useState<
    string | null
  >(null);
  /** Attachments for the open inline edit (reloaded from the message, editable). */
  const [editAttachments, setEditAttachments] = useState<Attachment[]>([]);
  const editingUserMessageIdRef = useRef<string | null>(null);
  editingUserMessageIdRef.current = editingUserMessageId;
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  /** Per-session message cache so switching away mid-turn does not drop the UI. */
  const messagesBySessionRef = useRef<Map<string, ChatMessage[]>>(new Map());
  const viewingSessionIdRef = useRef<string | null>(null);
  const liveHostRef = useRef<SessionSnapshot>(IDLE_SNAPSHOT);
  const messagesRef = useRef<ChatMessage[]>([]);
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({});
  const [projectsOpen, setProjectsOpen] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(true);
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState>(null);
  const [appDialog, setAppDialog] = useState<AppDialog>(null);
  const [dialogInput, setDialogInput] = useState("");
  const dialogInputRef = useRef<HTMLInputElement>(null);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);
  /** Latest dialog for Enter/Escape handlers (avoids stale chained confirms). */
  const appDialogRef = useRef<AppDialog>(null);
  appDialogRef.current = appDialog;
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showComposerPlus, setShowComposerPlus] = useState(false);
  showComposerPlusRef.current = showComposerPlus;
  const composerPlusTriggerRef = useRef<HTMLButtonElement>(null);
  const composerPlusPanelRef = useRef<HTMLDivElement>(null);
  const composerInputRef = useRef<HTMLDivElement>(null);
  /** Actual input card (.composer) — command panel anchors here. */
  const composerShellRef = useRef<HTMLDivElement>(null);
  /** Floating composer shell — height drives chat bottom padding. */
  const composerWrapRef = useRef<HTMLDivElement>(null);
  const [composerFloatPad, setComposerFloatPad] = useState(168);
  /** Set by newChat; applied after chat pane + textarea mount. */
  const pendingComposerFocus = useRef(false);
  const [sessionDataMode, setSessionDataMode] = useState("independent");
  const [defaultOpenTarget, setDefaultOpenTarget] = useState("finder");
  const [showUserMenu, setShowUserMenu] = useState(false);
  /** Hash route: workbench | settings/:section | automations */
  const [appView, setAppView] = useState<"workbench" | "settings">("workbench");
  /** Inside workbench: chat thread vs scheduled tasks list. */
  const [mainPane, setMainPane] = useState<"chat" | "automations">("chat");
  const [settingsSection, setSettingsSection] =
    useState<SettingsSectionId>("general");
  /** Prevent overlapping automation runs. */
  const automationRunLock = useRef(false);
  const firedAutomationIds = useRef<Set<string>>(new Set());
  /** Conversation is guiding the user to create a scheduled task. */
  const automationSetupDraftRef = useRef(false);
  const automationSetupSessionsRef = useRef<Set<string>>(new Set());
  const automationAppliedRef = useRef<Set<string>>(new Set());
  /** While openSession loads, do not let session.sessionId effect clobber viewing id. */
  const openingSessionIdRef = useRef<string | null>(null);

  // ContextMenu handles outside click + Escape for sidebar menus.

  useEffect(() => {
    if (!appDialog) return;
    if (appDialog.kind === "prompt") {
      setDialogInput(appDialog.initial);
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

  useEffect(() => {
    if (!appDialog) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setAppDialog(null);
        return;
      }
      // Confirm dialogs: Enter always accepts (including chained YOLO steps).
      // Capture phase + preventDefault so we don't double-fire with a focused
      // submit button's native activation.
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

  // Compact context modal: focus note field on open; Escape dismisses.
  useEffect(() => {
    if (!showCompactModal) return;
    const t = window.setTimeout(() => {
      compactNoteRef.current?.focus();
    }, 0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShowCompactModal(false);
        setCompactNote("");
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("keydown", onKey);
    };
  }, [showCompactModal]);

  useEffect(() => {
    if (!showSearch) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowSearch(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [showSearch]);

  // Global shortcuts: search, help, doctor, new chat, settings.
  // Handlers go through refs so we don't re-bind every render.
  const shortcutHandlersRef = useRef({
    newChat: () => {},
    openSettings: () => {},
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const typing =
        tag === "input" ||
        tag === "textarea" ||
        !!target?.isContentEditable;
      const key = e.key.toLowerCase();
      if (key === "k") {
        e.preventDefault();
        setShowSearch(true);
        return;
      }
      if (key === "/") {
        e.preventDefault();
        setShowShortcuts((v) => !v);
        return;
      }
      if (key === "," && !typing) {
        e.preventDefault();
        shortcutHandlersRef.current.openSettings();
        return;
      }
      if (key === "n" && !typing) {
        e.preventDefault();
        shortcutHandlersRef.current.newChat();
        return;
      }
      if (key === "d" && e.shiftKey) {
        e.preventDefault();
        setShowDoctor(true);
        return;
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  /** First-run gate: loading → setup wizard → ready (home). */
  const [appGate, setAppGate] = useState<"loading" | "setup" | "ready">(
    "loading",
  );
  // Ask once for notification permission after first ready.
  useEffect(() => {
    if (appGate !== "ready") return;
    void ensureNotifyPermission();
  }, [appGate]);
  const [setupCliSeed, setSetupCliSeed] = useState<SetupCliInfo | null>(null);
  const [showDoctor, setShowDoctor] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [savedAccounts, setSavedAccounts] = useState<api.SavedAccount[]>([]);
  const [activeAccountId, setActiveAccountId] = useState<string | null>(null);
  const [perm, setPerm] = useState<PermissionPayload | null>(null);
  const [askUser, setAskUser] = useState<AskUserPayload | null>(null);
  const [plan, setPlan] = useState<PlanState & { visible: boolean }>({
    title: "Plan ready for review",
    body: "",
    entries: [],
    waiting: true,
    // Only show when Agent sends a plan event (or user opens Plan mode later)
    visible: false,
    rpcId: null,
    toolCallId: null,
  });
  const [locale, setLocale] = useState<Locale>("zh");
  const localeRef = useRef(locale);
  localeRef.current = locale;
  const tr = useMemo(() => createT(locale), [locale]);
  const trRef = useRef(tr);
  trRef.current = tr;
  const [modelId, setModelId] = useState(DEFAULT_MODEL_ID);
  const [effort, setEffort] = useState(DEFAULT_EFFORT);
  const [mode, setMode] = useState("agent");
  const [policy, setPolicy] = useState("ask");
  /** Live selectable models from Host (official CLI catalog only; not providers). */
  const [availableModels, setAvailableModels] =
    useState<ModelOption[]>(GROK_BUILD_MODELS);
  /** Where model/permission chips are remembered. */
  const [prefsScope, setPrefsScope] =
    useState<ComposerPrefsScope>("global");
  /** Files/folders attached for next send (@path to agent). */
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  /** Chat file/url card → open in right resource pane. */
  const [resourceOpenTarget, setResourceOpenTarget] =
    useState<ResourceOpenTarget | null>(null);
  /** Live drag-drop target for zone overlays (null = not dragging). */
  const [dragZone, setDragZone] = useState<"sidebar" | "main" | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const dragPathsRef = useRef<string[]>([]);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const [, setSetup] = useState({ cli: false, auth: false, project: false });
  const [localError, setLocalError] = useState<string | null>(null);
  /** Expand technical dump under the compact error banner. */
  const [errorDetailOpen, setErrorDetailOpen] = useState(false);
  const [cliInfo, setCliInfo] = useState<{
    found: boolean;
    path: string | null;
    version: string | null;
    source: string;
    cliAuthPresent: boolean;
  }>({ found: false, path: null, version: null, source: "", cliAuthPresent: false });
  const [manualCliPath, setManualCliPath] = useState("");
  const [acpServerAddr, setAcpServerAddr] = useState("");
  const [maxConcurrentAgents, setMaxConcurrentAgents] = useState(3);
  const [agentIdleMinutes, setAgentIdleMinutes] = useState(30);
  const [connecting, setConnecting] = useState(false);
  /** Live provider retry progress (session://retry); cleared on success/stop/error. */
  const [retryStatus, setRetryStatus] = useState<{
    attempt: number;
    maxRetries: number;
    reason: string;
  } | null>(null);
  /** Epoch ms when the current agent turn became busy (for elapsed UI). */
  const [turnStartedAt, setTurnStartedAt] = useState<number | null>(null);
  const [resizingAside, setResizingAside] = useState(false);
  const [account, setAccount] = useState<api.AccountStatus | null>(null);
  const [accountLoading, setAccountLoading] = useState(false);
  const [accountBusy, setAccountBusy] = useState(false);
  const [loginHint, setLoginHint] = useState<string | null>(null);
  const platform = useMemo(() => {
    const ua = navigator.userAgent.toLowerCase();
    if (ua.includes("mac")) return "mac" as const;
    if (ua.includes("win")) return "win" as const;
    return "other" as const;
  }, []);
  /** Self-drawn chrome when OS title bar is disabled (Windows release config). */
  const useCustomWindowChrome = platform === "win" || platform === "other";
  const [windowMaximized, setWindowMaximized] = useState(false);

  useEffect(() => {
    applyThemeToDocument(theme);
    void applyNativeWindowTheme(theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.classList.remove(
      "platform-mac",
      "platform-win",
      "platform-other",
    );
    if (platform === "mac") document.documentElement.classList.add("platform-mac");
    if (platform === "win") document.documentElement.classList.add("platform-win");
    if (platform === "other") document.documentElement.classList.add("platform-other");
  }, [platform]);

  useEffect(() => {
    if (!useCustomWindowChrome || !api.isTauri()) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const w = getCurrentWindow();
        const sync = async () => {
          try {
            setWindowMaximized(await w.isMaximized());
          } catch {
            /* ignore */
          }
        };
        await sync();
        unlisten = await w.onResized(() => {
          void sync();
        });
        if (cancelled) unlisten?.();
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [useCustomWindowChrome]);

  const applyComposerPrefs = useCallback(
    (prefs: api.ComposerPrefs, catalog: ModelOption[]) => {
      const models = catalog.length > 0 ? catalog : GROK_BUILD_MODELS;
      if (prefs.modelId && isValidModelId(prefs.modelId, models)) {
        setModelId(prefs.modelId);
      } else {
        setModelId(pickDefaultModelId(models));
      }
      setEffort(
        isValidEffort(prefs.effort) ? prefs.effort : DEFAULT_EFFORT,
      );
      setMode(prefs.mode || "agent");
      setPolicy(
        isValidPolicy(prefs.permissionPolicy) ? prefs.permissionPolicy : "ask",
      );
      if (isValidPrefsScope(prefs.scope)) {
        setPrefsScope(prefs.scope);
      }
    },
    [],
  );

  const refreshLists = useCallback(async () => {
    if (!api.isTauri()) {
      // Browser/Vite-only preview: skip Host gate.
      setAppGate("ready");
      setSetupCliSeed({
        found: true,
        path: null,
        version: "browser",
        source: "browser",
        cliAuthPresent: false,
      });
      return;
    }
    try {
      const [p, s, settings, cli, modelsRes] = await Promise.all([
        api.projectsList(),
        api.sessionsList(),
        api.settingsGet(),
        api.probeCli(),
        api.modelsListAvailable().catch(() => null),
      ]);
      setProjects(
        (p as Project[]).map((x) => ({
          ...x,
          pinned: !!(x as Project).pinned,
        })),
      );
      setSessions(
        (
          s as Array<SessionRow & { archived?: boolean; scheduled?: boolean }>
        ).map((x) => ({
          id: x.id,
          title: x.title,
          projectId: x.projectId,
          updatedAt: x.updatedAt,
          archived: !!x.archived,
          scheduled: !!x.scheduled,
        })),
      );
      void api.trayRefresh();
      setLocale(resolveLocale(settings.locale));
      const catalog: ModelOption[] =
        modelsRes?.models?.length
          ? modelsRes.models.map((m) => ({
              id: m.id,
              label: m.label || m.id,
              source: m.source,
              isDefault: m.isDefault,
            }))
          : GROK_BUILD_MODELS;
      setAvailableModels(catalog);
      if (
        settings.composerPrefsScope &&
        isValidPrefsScope(settings.composerPrefsScope)
      ) {
        setPrefsScope(settings.composerPrefsScope);
      }
      // Bootstrap: global-effective prefs (context re-resolved when project/session changes).
      const prefs = await api
        .composerPrefsResolve({ projectId: null, sessionId: null })
        .catch(() => null);
      if (prefs) {
        applyComposerPrefs(prefs, catalog);
      } else {
        setPolicy(
          isValidPolicy(settings.permissionPolicy || "")
            ? settings.permissionPolicy
            : "ask",
        );
        setEffort(
          isValidEffort(settings.effort || "")
            ? (settings.effort as typeof effort)
            : DEFAULT_EFFORT,
        );
        setMode(settings.mode || "agent");
        if (settings.modelId && isValidModelId(settings.modelId, catalog)) {
          setModelId(settings.modelId);
        } else {
          setModelId(
            modelsRes?.defaultModelId &&
              isValidModelId(modelsRes.defaultModelId, catalog)
              ? modelsRes.defaultModelId
              : pickDefaultModelId(catalog),
          );
        }
      }
      setSessionDataMode(settings.sessionDataMode || "independent");
      setDefaultOpenTarget(
        (settings as { defaultOpenTarget?: string }).defaultOpenTarget ||
          "finder",
      );
      setManualCliPath(settings.manualCliPath || cli.path || "");
      setAcpServerAddr(settings.acpServerAddr || "");
      setMaxConcurrentAgents(
        typeof settings.maxConcurrentAgents === "number" &&
          settings.maxConcurrentAgents >= 1
          ? Math.min(8, Math.round(settings.maxConcurrentAgents))
          : 3,
      );
      setAgentIdleMinutes(
        typeof settings.agentIdleMinutes === "number" &&
          settings.agentIdleMinutes >= 1
          ? Math.min(1440, Math.round(settings.agentIdleMinutes))
          : 30,
      );
      setCliInfo({
        found: cli.found,
        path: cli.path,
        version: cli.version,
        source: cli.source || "",
        cliAuthPresent: !!cli.cliAuthPresent,
      });
      const masked = await api.secretsGetMasked();
      const authOk =
        !!cli.cliAuthPresent ||
        masked.hasOfficialKey ||
        masked.hasRelayKey;
      setSetup({
        cli: cli.found,
        auth: authOk,
        project: p.some((x) => (x as Project).trusted) || p.length > 0,
      });

      // ── Setup gate: CLI is hard-required; account may be deferred ──
      const cliSeed: SetupCliInfo = {
        found: cli.found,
        path: cli.path,
        version: cli.version,
        source: cli.source || "",
        cliAuthPresent: !!cli.cliAuthPresent,
      };
      setSetupCliSeed(cliSeed);

      const wizardCompleted = !!settings.setupWizardCompleted;
      const legacyDone =
        !!settings.onboardingDone || !!settings.setupSkipped;

      if (cli.found && !wizardCompleted && legacyDone) {
        // Migrate older installs that already finished the account modal.
        try {
          await api.settingsSet({
            ...settings,
            setupWizardCompleted: true,
            authSetupDeferred: !!settings.setupSkipped && !authOk,
          });
        } catch {
          /* ignore */
        }
        setAppGate("ready");
      } else if (!cli.found || !wizardCompleted) {
        // No CLI → always wizard. First launch with CLI → account step.
        setAppGate("setup");
      } else {
        setAppGate("ready");
      }

      // Prefer first trusted project; keep selection if still present
      setActiveProject((prev) => {
        if (prev && (p as Project[]).some((x) => x.id === prev.id)) {
          return (p as Project[]).find((x) => x.id === prev.id) || prev;
        }
        return (
          (p as Project[]).find((x) => x.trusted) ||
          (p as Project[])[0] ||
          null
        );
      });
      setExpandedProjects((prev) => {
        const next = { ...prev };
        for (const proj of p as Project[]) {
          if (next[proj.id] === undefined) next[proj.id] = true;
        }
        return next;
      });
    } catch (e) {
      setLocalError(String(e));
      // Still surface setup if Tauri partially works
      setSetupCliSeed((prev) =>
        prev ?? {
          found: false,
          path: null,
          version: null,
          source: "error",
          cliAuthPresent: false,
        },
      );
      setAppGate((g) => (g === "loading" ? "setup" : g));
    }
  }, []);

  // Bootstrap lists once
  useEffect(() => {
    void refreshLists();
  }, [refreshLists]);

  // Re-resolve model/permission when project or chat changes (project/session scope).
  useEffect(() => {
    if (!api.isTauri()) return;
    if (prefsScope === "global") return;
    let cancelled = false;
    void api
      .composerPrefsResolve({
        projectId: activeProject?.id ?? null,
        sessionId: session.sessionId ?? null,
      })
      .then((prefs) => {
        if (!cancelled) applyComposerPrefs(prefs, availableModels);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [
    activeProject?.id,
    session.sessionId,
    prefsScope,
    applyComposerPrefs,
    availableModels,
  ]);

  // Keep refs aligned for event handlers — but not while openSession is loading
  // (otherwise an intermediate null sessionId wipes viewing id and skips UI update).
  useEffect(() => {
    if (openingSessionIdRef.current) return;
    viewingSessionIdRef.current = session.sessionId;
  }, [session.sessionId]);

  useEffect(() => {
    liveHostRef.current = liveHost;
  }, [liveHost]);

  // Mirror viewed-session messages into the cache on every change.
  useEffect(() => {
    messagesRef.current = messages;
    const id = session.sessionId;
    if (!id) return;
    messagesBySessionRef.current.set(id, messages);
  }, [messages, session.sessionId]);

  /** Apply a message reducer to the viewed session or only to the cache. */
  const patchSessionMessages = useCallback(
    (
      targetSessionId: string | undefined | null,
      reduce: (prev: ChatMessage[]) => ChatMessage[],
    ) => {
      if (!targetSessionId) return;
      if (viewingSessionIdRef.current === targetSessionId) {
        setMessages((prev) => {
          const next = reduce(prev);
          messagesBySessionRef.current.set(targetSessionId, next);
          return next;
        });
      } else {
        const prev = messagesBySessionRef.current.get(targetSessionId) ?? [];
        messagesBySessionRef.current.set(targetSessionId, reduce(prev));
      }
    },
    [],
  );

  /**
   * After any turn, if the last assistant message contains a grok-automation
   * fence, strip it from the bubble and call automation_create.
   * Applies to all sessions (not only “用 AI 创建”), so normal chat can schedule.
   * Deduped per assistant message id.
   */
  const tryApplyAutomationFromSession = useCallback(
    async (sessionId: string) => {
      if (!sessionId) return;

      const msgs = messagesBySessionRef.current.get(sessionId) ?? [];
      let lastAssistantIdx = -1;
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i]?.role === "assistant" && !msgs[i]?.isError) {
          lastAssistantIdx = i;
          break;
        }
      }
      if (lastAssistantIdx < 0) return;
      const assistant = msgs[lastAssistantIdx]!;
      if (assistant.streaming) return;

      const applyKey = assistant.id || `${sessionId}:last`;
      if (automationAppliedRef.current.has(applyKey)) return;

      const { cleanText, input, rawJson } = extractAutomationPayload(
        assistant.content || "",
      );
      // Always strip fence from UI when present (even if JSON incomplete).
      if (cleanText !== (assistant.content || "")) {
        const aid = assistant.id;
        patchSessionMessages(sessionId, (prev) =>
          prev.map((m) => (m.id === aid ? { ...m, content: cleanText } : m)),
        );
      }
      if (!input) return;

      // Also dedupe identical payloads in this session.
      const payloadKey = `${sessionId}:${rawJson ?? input.title}`;
      if (automationAppliedRef.current.has(payloadKey)) return;

      automationAppliedRef.current.add(applyKey);
      automationAppliedRef.current.add(payloadKey);
      try {
        const created = await api.automationCreate(input);
        automationSetupSessionsRef.current.delete(sessionId);
        setToast(
          tr("automations.createdToast", {
            title: created.title || input.title,
          }),
        );
        window.setTimeout(() => setToast(null), 4200);
      } catch {
        automationAppliedRef.current.delete(applyKey);
        automationAppliedRef.current.delete(payloadKey);
        setToast(tr("automations.createFailed"));
        window.setTimeout(() => setToast(null), 4200);
      }
    },
    [patchSessionMessages, tr],
  );

  // Event listeners: StrictMode-safe (cleanup cancels pending + live unsubs)
  useEffect(() => {
    if (!api.isTauri()) return;
    let cancelled = false;
    const cleanups: Array<() => void> = [];

    const track = async (p: Promise<() => void>) => {
      const un = await p;
      if (cancelled) {
        un();
      } else {
        cleanups.push(un);
      }
    };

    void (async () => {
      try {
        const snap = await api.sessionGetState();
        if (!cancelled) {
          setLiveHost(snap);
          liveHostRef.current = snap;
          // Only bind the viewed session when Host already has a live row.
          if (snap.sessionId) {
            setSession(snap);
            viewingSessionIdRef.current = snap.sessionId;
          }
        }

        await track(
          api.listen<SessionSnapshot>("session://state", (s) => {
            if (cancelled) return;
            setLiveHost(s);
            liveHostRef.current = s;
            // Only update the workbench session when the user is viewing it.
            // Otherwise switching sessions would yank selection back to the live agent.
            if (
              s.sessionId &&
              s.sessionId === viewingSessionIdRef.current
            ) {
              setSession(s);
              // Clear retry chip / turn timer when turn ends or errors out
              if (s.state !== "streaming" && s.state !== "awaiting_permission") {
                setRetryStatus(null);
                setTurnStartedAt(null);
                // Ensure no assistant is left with streaming=true after the turn
                // (missed done chunk) — otherwise the next send can bind to it.
                setMessages((prev) => {
                  if (!prev.some((m) => m.streaming)) return prev;
                  const next = prev.map((m) =>
                    m.streaming ? { ...m, streaming: false } : m,
                  );
                  if (s.sessionId) {
                    messagesBySessionRef.current.set(s.sessionId, next);
                  }
                  return next;
                });
                if (s.state === "ready") {
                  showDesktopNotification({
                    title: trRef.current("notify.turnDoneTitle"),
                    body: trRef.current("notify.turnDoneBody"),
                    tag: `turn-${s.sessionId || "x"}`,
                  });
                }
              } else if (
                (s.state === "streaming" || s.state === "awaiting_permission") &&
                s.sessionId === viewingSessionIdRef.current
              ) {
                setTurnStartedAt((prev) => prev ?? Date.now());
              }
              // After a turn, resolve `images/N.jpg` short paths into image cards
              if (s.state === "ready") {
                const sid = s.sessionId;
                setMessages((prev) => {
                  const rels = collectSessionRelativeMediaRefs(prev);
                  if (!rels.length) return prev;
                  void api
                    .sessionResolveRelativeMedia(sid, rels)
                    .then((list) => {
                      if (
                        cancelled ||
                        !list.length ||
                        viewingSessionIdRef.current !== sid
                      ) {
                        return;
                      }
                      const resolved = list.map((a) => ({
                        path: a.path,
                        name:
                          a.name ||
                          a.path.split(/[/\\]/).pop() ||
                          a.path,
                        isDir: !!a.isDir,
                      }));
                      setMessages((cur) =>
                        applyResolvedSessionMedia(cur, resolved),
                      );
                    })
                    .catch(() => {
                      /* ignore */
                    });
                  return prev;
                });
              }
            } else if (!isSessionBusy(s.state)) {
              if (viewingSessionIdRef.current === s.sessionId) {
                setRetryStatus(null);
              }
              // Backup apply path if stream `done` chunk was missed.
              if (s.sessionId) {
                void tryApplyAutomationFromSession(s.sessionId);
              }
            }
          }),
        );
        await track(
          api.listen<StreamPayload>("session://stream", (chunk) => {
            if (cancelled) return;
            // Ignore empty terminal ticks that only flip done
            if (!chunk.text && !chunk.done) return;
            // Defense-in-depth: drop stream chunks that arrive while no live turn
            // is active (the host already gates this on FSM Streaming, but stale
            // or replayed chunks must never re-type history on session switch).
            if (
              chunk.text &&
              !isSessionLiveStreaming(liveHostRef.current.state)
            ) {
              return;
            }
            if (
              chunk.text &&
              chunk.sessionId === viewingSessionIdRef.current
            ) {
              setRetryStatus(null);
            }
            patchSessionMessages(chunk.sessionId, (prev) => {
              const next = applyStreamChunk(prev, chunk);
              // Keep cache in sync immediately so post-turn apply sees final text.
              if (chunk.sessionId) {
                messagesBySessionRef.current.set(chunk.sessionId, next);
              }
              return next;
            });
            // After a completed assistant stream, try silent automation create.
            if (chunk.done && chunk.sessionId) {
              void tryApplyAutomationFromSession(chunk.sessionId);
            }
          }),
        );
        await track(
          api.listen<GeneratedImagePayload>(
            "session://generated_image",
            (p) => {
              if (cancelled || !p?.path) return;
              patchSessionMessages(p.sessionId, (prev) =>
                applyGeneratedImage(prev, p),
              );
            },
          ),
        );
        await track(
          api.listen<{
            sessionId?: string;
            messageId?: string;
            trigger?: string;
            tokensBefore?: number;
            tokensAfter?: number;
            summaryPreview?: string;
            note?: string;
            content?: string;
          }>("session://context_compact", (p) => {
            if (cancelled || !p) return;
            const sid = p.sessionId;
            if (!sid) return;
            patchSessionMessages(sid, (prev) => applyContextCompact(prev, p));
            if (sid === viewingSessionIdRef.current) {
              setContextUsage((prev) =>
                reduceContextUsage(prev, {
                  type: "compact",
                  trigger: p.trigger,
                  tokensBefore: p.tokensBefore,
                  tokensAfter: p.tokensAfter,
                  summaryPreview: p.summaryPreview,
                  note: p.note,
                  messageId: p.messageId,
                }),
              );
              const auto = (p.trigger || "auto").toLowerCase() !== "manual";
              setToast(
                auto
                  ? tr("compact.toastAuto")
                  : tr("compact.toastManual"),
              );
              window.setTimeout(() => setToast(null), 3200);
            }
          }),
        );
        await track(
          api.listen<{
            sessionId?: string;
            toolCallId?: string;
            title?: string;
            kind?: string;
            status?: string;
            path?: string | null;
            detail?: string | null;
            before?: string | null;
            after?: string | null;
          }>("session://tool", (p) => {
            if (cancelled || !p?.toolCallId) return;
            const sid = p.sessionId || viewingSessionIdRef.current;
            if (!sid) return;
            patchSessionMessages(sid, (prev) => applyToolEvent(prev, p));
            // Track write/edit tools for the session Changes panel.
            setSessionChangesById((prev) => {
              const list = prev[sid] ?? [];
              const next = mergeSessionChange(list, {
                toolCallId: p.toolCallId,
                title: p.title,
                kind: p.kind,
                status: p.status,
                path: p.path,
                detail: p.detail,
                before: p.before,
                after: p.after,
              });
              if (next === list) return prev;
              return { ...prev, [sid]: next };
            });
            if (sid === viewingSessionIdRef.current) {
              setTurnStartedAt((t) => t ?? Date.now());
            }
          }),
        );
        await track(
          api.listen<{
            sessionId?: string;
            messageId?: string;
            marker?: string;
            reason?: string;
            content?: string;
          }>("session://turn_marker", (p) => {
            if (cancelled || !p) return;
            const sid = p.sessionId;
            if (!sid) return;
            patchSessionMessages(sid, (prev) => applyTurnMarker(prev, p));
            if (sid === viewingSessionIdRef.current) {
              setTurnStartedAt(null);
              if (p.marker === "turn_cancelled") {
                setToast(tr("activity.cancelledToast"));
                window.setTimeout(() => setToast(null), 2800);
              }
            }
          }),
        );
        await track(
          api.listen<{ sessionId?: string; reason?: string }>(
            "session://idle_recycled",
            (p) => {
              if (cancelled || !p) return;
              if (p.reason === "capacity") {
                setToast(tr("agent.processLimitToast"));
                window.setTimeout(() => setToast(null), 5200);
                return;
              }
              // Toast when the focused (or unknown) session was idle-recycled.
              if (
                !p.sessionId ||
                p.sessionId === viewingSessionIdRef.current
              ) {
                setToast(tr("agent.idleRecycledToast"));
                window.setTimeout(() => setToast(null), 4200);
              }
            },
          ),
        );
        await track(
          api.listen<{
            sessionId?: string;
            code?: string;
            message?: string;
            maxConcurrentAgents?: number;
          }>("session://process_limit", (p) => {
            if (cancelled || !p) return;
            setToast(tr("agent.processLimitToast"));
            window.setTimeout(() => setToast(null), 5200);
            if (
              !p.sessionId ||
              p.sessionId === viewingSessionIdRef.current
            ) {
              setLocalError(
                p.message
                  ? `PROCESS_LIMIT: ${p.message}`
                  : "PROCESS_LIMIT",
              );
            }
          }),
        );
        await track(
          api.listen<{
            attempt?: number;
            maxRetries?: number;
            reason?: string;
            aborting?: boolean;
            sessionId?: string;
          }>("session://retry", (p) => {
            if (cancelled) return;
            // Retry chip is only meaningful on the viewed live session.
            if (
              p.sessionId &&
              p.sessionId !== viewingSessionIdRef.current
            ) {
              return;
            }
            if (
              liveHostRef.current.sessionId &&
              liveHostRef.current.sessionId !== viewingSessionIdRef.current
            ) {
              return;
            }
            const attempt = p.attempt ?? 0;
            const maxRetries = p.maxRetries ?? 5;
            const reason = (p.reason || "").trim();
            setRetryStatus({ attempt, maxRetries, reason });
          }),
        );
        await track(
          api.listen<TurnErrorPayload>("session://turn_error", (p) => {
            if (cancelled) return;
            if (p.sessionId === viewingSessionIdRef.current) {
              setRetryStatus(null);
            }
            patchSessionMessages(p.sessionId, (prev) =>
              applyTurnError(prev, p, localeRef.current),
            );
          }),
        );
        await track(
          api.listen<PermissionPayload>("session://permission", (p) => {
            if (cancelled) return;
            // Only surface the bar when viewing the session that needs it.
            if (
              p.sessionId &&
              p.sessionId !== viewingSessionIdRef.current
            ) {
              return;
            }
            setPerm(p);
            showDesktopNotification({
              title: trRef.current("notify.permissionTitle"),
              body: trRef.current("notify.permissionBody"),
              tag: `perm-${p.rpcId}`,
              force: true,
            });
          }),
        );
        await track(
          api.listen<AskUserPayload>("session://ask_user", (p) => {
            if (cancelled) return;
            if (
              p.sessionId &&
              p.sessionId !== viewingSessionIdRef.current
            ) {
              return;
            }
            if (!p?.rpcId || !Array.isArray(p.questions) || !p.questions.length) {
              return;
            }
            setAskUser(p);
          }),
        );
        await track(
          api.listen<{
            entries?: unknown[];
            body?: string | null;
            sessionId?: string;
            rpcId?: number | null;
            toolCallId?: string | null;
            waiting?: boolean;
          }>("session://plan", (p) => {
            if (cancelled) return;
            if (
              p.sessionId &&
              p.sessionId !== viewingSessionIdRef.current
            ) {
              return;
            }
            const body = (p.body || "").trim();
            const entries = Array.isArray(p.entries) ? p.entries : [];
            // Prefer markdown planContent; fall back to readable entries list
            let displayBody = body;
            if (!displayBody && entries.length) {
              displayBody = entries
                .map((e, i) => {
                  if (e && typeof e === "object") {
                    const o = e as Record<string, unknown>;
                    const content = String(o.content ?? o.title ?? o.text ?? "");
                    const st = o.status ? ` [${o.status}]` : "";
                    const pr = o.priority ? ` (${o.priority})` : "";
                    return `${i + 1}. ${content}${pr}${st}`;
                  }
                  return `${i + 1}. ${String(e)}`;
                })
                .join("\n");
            }
            // Preserve exit_plan_mode rpcId across later sessionUpdate plan
            // notifications (those arrive with rpcId=null and would otherwise
            // disable Approve / Request changes — see #17).
            setPlan((prev) => {
              const rpcId =
                p.rpcId != null
                  ? p.rpcId
                  : prev.visible
                    ? (prev.rpcId ?? null)
                    : null;
              return {
                title: tr("plan.ready"),
                body: displayBody || (prev.visible ? prev.body : ""),
                entries: entries.length
                  ? entries
                  : prev.visible
                    ? prev.entries
                    : [],
                waiting: rpcId == null,
                visible: true,
                rpcId,
                toolCallId:
                  p.toolCallId != null
                    ? p.toolCallId
                    : prev.visible
                      ? (prev.toolCallId ?? null)
                      : null,
              };
            });
          }),
        );
        await track(
          api.listen<{ sessionId?: string; title?: string }>(
            "session://title",
            (p) => {
              if (cancelled || !p.sessionId || !p.title) return;
              setSessions((list) =>
                list.map((s) =>
                  s.id === p.sessionId ? { ...s, title: p.title! } : s,
                ),
              );
              setSession((prev) =>
                prev.sessionId === p.sessionId
                  ? { ...prev, title: p.title! }
                  : prev,
              );
              setLiveHost((prev) =>
                prev.sessionId === p.sessionId
                  ? { ...prev, title: p.title! }
                  : prev,
              );
            },
          ),
        );
      } catch (e) {
        if (!cancelled) setLocalError(String(e));
      }
    })();

    return () => {
      cancelled = true;
      cleanups.forEach((u) => u());
    };
  }, [patchSessionMessages, tryApplyAutomationFromSession]);

  const toggleThemeBtn = () => {
    setTheme((t) => {
      const n = toggleTheme(t);
      saveTheme(localStorage, n);
      applyThemeToDocument(n);
      void applyNativeWindowTheme(n);
      return n;
    });
  };

  const applyThemeChoice = (next: Theme) => {
    saveTheme(localStorage, next);
    applyThemeToDocument(next);
    void applyNativeWindowTheme(next);
    setTheme(next);
  };

  const navigateWorkbench = useCallback(() => {
    setAppView("workbench");
    setMainPane("chat");
    if (typeof window !== "undefined" && window.location.hash) {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  }, []);

  const navigateAutomations = useCallback(() => {
    setAppView("workbench");
    setMainPane("automations");
    setShowUserMenu(false);
    if (typeof window !== "undefined") {
      window.location.hash = "#/automations";
    }
  }, []);

  const persistOpenTarget = useCallback((target: string) => {
    setDefaultOpenTarget(target);
    try {
      localStorage.setItem("grok-app.openTarget", target);
    } catch {
      /* ignore */
    }
    void api.settingsGet().then((s) =>
      api.settingsSet({ ...s, defaultOpenTarget: target }),
    );
  }, []);

  const navigateSettings = useCallback((section: SettingsSectionId = "general") => {
    setSettingsSection(section);
    setAppView("settings");
    setShowUserMenu(false);
    if (typeof window !== "undefined") {
      window.location.hash = `#/settings/${section}`;
    }
  }, []);

  // Hash route: #/settings[/section] | #/automations | #/workbench
  useEffect(() => {
    const syncFromHash = () => {
      const raw = (window.location.hash || "").replace(/^#\/?/, "");
      if (raw.startsWith("settings")) {
        const part = raw.split("/")[1] as SettingsSectionId | undefined;
        const allowed: SettingsSectionId[] = [
          "general",
          "appearance",
          "account",
          "archived",
          "extensions",
          "runtime",
          "about",
        ];
        setSettingsSection(
          part && allowed.includes(part) ? part : "general",
        );
        setAppView("settings");
      } else if (raw === "automations" || raw.startsWith("automations")) {
        setAppView("workbench");
        setMainPane("automations");
      } else if (raw === "" || raw === "workbench" || raw === "home") {
        setAppView("workbench");
        setMainPane("chat");
      }
    };
    syncFromHash();
    window.addEventListener("hashchange", syncFromHash);
    return () => window.removeEventListener("hashchange", syncFromHash);
  }, []);

  /**
   * Open a stored session. Loads journal immediately; warms the ACP agent in
   * the background so the first send skips cold process spawn when possible.
   */
  const openSession = async (s: SessionRow, project?: Project | null) => {
    const proj =
      project ||
      projects.find((p) => p.id === s.projectId) ||
      null;
    setMainPane("chat");
    setAppView("workbench");

    // Snapshot the outgoing thread so a mid-turn switch does not lose the user bubble.
    const leavingId = viewingSessionIdRef.current;
    if (leavingId) {
      messagesBySessionRef.current.set(leavingId, messagesRef.current);
    }

    // Point viewing id immediately so late stream chunks land in the right cache.
    openingSessionIdRef.current = s.id;
    viewingSessionIdRef.current = s.id;
    setEditingUserMessageId(null);
    setEditAttachments([]);

    try {
      const stored = await api.sessionMessages(s.id);
      let mapped: ChatMessage[] = stored.map((m) => {
        const parsed = parseAttachmentsFromContent(m.content);
        const storedAtts: Attachment[] = (m.attachments ?? []).map((a) => ({
          path: a.path,
          name: a.name || a.path.split(/[/\\]/).pop() || a.path,
          isDir: !!a.isDir,
        }));
        // @path lines (user) + persisted image_gen cards + absolute paths in text
        const attachments = mergeMessageAttachments(
          mergeAttachments(parsed.attachments, storedAtts),
          m.content,
        );
        const rawContent =
          parsed.text || (parsed.attachments.length ? "" : m.content);
        // User turns: restore [[skill:]] chips from agent-form `/name` history.
        const content =
          m.role === "user" ? hydrateDisplayContent(rawContent) : rawContent;
        const rawMarker = (m as { marker?: string }).marker || undefined;
        const marker =
          rawMarker ||
          (m.role === "tool" && content.startsWith("context_compact")
            ? "context_compact"
            : m.role === "tool" && content.startsWith("tool_step|")
              ? "tool_step"
              : m.role === "tool" && content.startsWith("turn_cancelled")
                ? "turn_cancelled"
                : undefined);
        const compactMeta =
          marker === "context_compact"
            ? parseCompactContent(content) || undefined
            : undefined;
        const toolParsed =
          marker === "tool_step" ? parseToolStepContent(content) : null;
        const role = m.role as "user" | "assistant" | "tool";
        let displayContent = toolParsed?.title || content;
        // Never show silent automation fence to the user on reload.
        if (role === "assistant" && displayContent) {
          displayContent = extractAutomationPayload(displayContent).cleanText;
        }
        const thoughtPhases = splitThoughtPhases(m.thought);
        return {
          id: m.id,
          role,
          content: displayContent,
          thought: m.thought ?? undefined,
          thoughtPhases,
          // Reconstruct interleaved timeline for reload (first phase → body → rest).
          segments:
            role === "assistant"
              ? buildSegmentsFromLegacy(
                  displayContent,
                  m.thought,
                  thoughtPhases,
                )
              : undefined,
          isError: m.isError || undefined,
          attachments,
          createdAt: m.createdAt || undefined,
          marker,
          compactMeta: compactMeta ?? undefined,
          toolCallId: m.id.startsWith("tool-") ? m.id.slice(5) : undefined,
          toolKind: toolParsed?.kind,
          toolStatus: toolParsed?.status,
          toolDetail: toolParsed?.detail,
          toolPath: toolParsed?.path,
          streaming: false,
        };
      });
      // Short paths like `images/1.jpg` → agent session dir → image cards
      if (api.isTauri()) {
        const rels = collectSessionRelativeMediaRefs(mapped);
        if (rels.length) {
          try {
            const list = await api.sessionResolveRelativeMedia(s.id, rels);
            if (list.length) {
              mapped = applyResolvedSessionMedia(
                mapped,
                list.map((a) => ({
                  path: a.path,
                  name:
                    a.name || a.path.split(/[/\\]/).pop() || a.path,
                  isDir: !!a.isDir,
                })),
              );
            }
          } catch {
            /* ignore */
          }
        }
      }
      // Prefer in-memory cache (optimistic user msg + partial stream) over disk.
      const chosen = preferSessionMessages(
        messagesBySessionRef.current.get(s.id),
        mapped,
      );
      if (viewingSessionIdRef.current !== s.id) {
        // User switched again while we were loading — keep cache warm, skip UI write.
        messagesBySessionRef.current.set(s.id, chosen);
        if (openingSessionIdRef.current === s.id) {
          openingSessionIdRef.current = null;
        }
        return;
      }
      // Cache raw journal (may include fences) so apply can read them.
      messagesBySessionRef.current.set(s.id, chosen);
      // Rebuild Changes list from tool_step history; preserve live before/after.
      {
        const fromHist = sessionChangesFromMessages(chosen);
        setSessionChangesById((prev) => {
          const existing = prev[s.id] ?? [];
          let list = fromHist;
          for (const e of existing) {
            if (e.before != null || e.after != null) {
              list = mergeSessionChange(list, {
                toolCallId: e.toolCallId,
                title: e.title,
                kind: e.toolKind,
                status: e.status,
                path: e.path,
                before: e.before,
                after: e.after,
                updatedAt: e.updatedAt,
              });
            }
          }
          return { ...prev, [s.id]: list };
        });
      }
      const stripped = chosen.map((m) => {
        if (m.role !== "assistant" || !m.content) return m;
        const { cleanText } = extractAutomationPayload(m.content);
        return cleanText === m.content ? m : { ...m, content: cleanText };
      });
      setMessages(stripped);
      setContextUsage(
        reduceContextUsage(INITIAL_CONTEXT_USAGE, {
          type: "hydrate",
          messages: stripped,
        }),
      );
      // Backfill create if assistant still has a fence in journal (failed chat-create).
      void tryApplyAutomationFromSession(s.id);
      // Backfill scheduled flag from journal (older automation sessions).
      if (
        !s.scheduled &&
        chosen.some(
          (m) =>
            m.role === "user" && !!parseScheduledUserContent(m.content || ""),
        )
      ) {
        setSessions((list) =>
          list.map((row) =>
            row.id === s.id ? { ...row, scheduled: true } : row,
          ),
        );
        if (api.isTauri()) {
          void api.sessionSetScheduled(s.id, true).catch(() => {});
        }
      }
      // Refine isDir via classify when possible
      const allPaths = chosen.flatMap((m) => m.attachments?.map((a) => a.path) ?? []);
      if (allPaths.length && api.isTauri()) {
        void api.pathsClassify(allPaths).then((list) => {
          if (viewingSessionIdRef.current !== s.id) return;
          const byPath = new Map(list.map((c) => [c.path, c]));
          setMessages((prev) =>
            prev.map((msg) => {
              if (!msg.attachments?.length) return msg;
              return {
                ...msg,
                attachments: msg.attachments.map((a) => {
                  const c = byPath.get(a.path);
                  return c
                    ? { path: c.path, name: c.name, isDir: c.isDir }
                    : a;
                }),
              };
            }),
          );
        });
      }
    } catch {
      if (viewingSessionIdRef.current !== s.id) {
        if (openingSessionIdRef.current === s.id) {
          openingSessionIdRef.current = null;
        }
        return;
      }
      const cached = messagesBySessionRef.current.get(s.id);
      setMessages(cached ?? []);
      setContextUsage(
        reduceContextUsage(INITIAL_CONTEXT_USAGE, {
          type: "hydrate",
          messages: cached ?? [],
        }),
      );
    }
    if (viewingSessionIdRef.current !== s.id) {
      if (openingSessionIdRef.current === s.id) {
        openingSessionIdRef.current = null;
      }
      return;
    }
    // Orphan sessions clear project context; project sessions select their folder.
    setActiveProject(proj);
    setAttachments([]);
    // Reattach live host snapshot when reopening the session that is still running.
    const live = liveHostRef.current;
    if (live.sessionId === s.id) {
      setSession({
        ...live,
        title: s.title || live.title || "Untitled",
      });
    } else {
      setSession({
        ...IDLE_SNAPSHOT,
        sessionId: s.id,
        title: s.title || "Untitled",
        state: "idle",
        backend: "grok_agent_stdio",
      });
    }
    if (openingSessionIdRef.current === s.id) {
      openingSessionIdRef.current = null;
    }
    setLocalError(null);
    // Permission / retry / ask-user chrome only apply to the live viewed session.
    if (live.sessionId !== s.id) {
      setPerm(null);
      setAskUser(null);
      setRetryStatus(null);
    }

    // Warm ACP: connect while the user reads history (trusted project or orphan).
    // Host serializes connect; first send no-ops if already ready, or waits if
    // still handshaking. Process is reused across sessions when cwd/effort match.
    if (
      api.isTauri() &&
      (!proj || proj.trusted) &&
      !(live.sessionId === s.id && live.state === "ready")
    ) {
      const warmId = s.id;
      void (async () => {
        if (viewingSessionIdRef.current !== warmId) return;
        try {
          const snap = await api.sessionConnect({
            projectPath: proj?.path,
            sessionId: warmId,
          });
          if (viewingSessionIdRef.current !== warmId) return;
          setLiveHost(snap);
          liveHostRef.current = snap;
          if (snap.sessionId === warmId) {
            setSession((prev) => ({
              ...snap,
              title: prev.title || s.title || snap.title || "Untitled",
            }));
          }
          if (snap.lastError && snap.state !== "ready") {
            // Soft: keep chat readable; send will retry via ensureConnected.
            console.warn(
              "warm connect:",
              snap.lastError.code,
              snap.lastError.message,
            );
          }
        } catch (e) {
          console.warn("warm connect failed", e);
        }
      })();
    }
  };

  /**
   * Focus composer after React commit. Retries until the textarea is mounted
   * (e.g. switching from automations → chat) or attempts run out.
   * Must be called after any await so state updates have been scheduled.
   */
  const requestComposerFocus = useCallback(() => {
    pendingComposerFocus.current = true;
    const tryFocus = (attemptsLeft: number) => {
      const el = composerInputRef.current;
      if (el && el.getAttribute("contenteditable") !== "false") {
        el.focus({ preventScroll: true });
        resizeComposer(el);
        try {
          const sel = window.getSelection();
          if (sel) {
            const range = document.createRange();
            range.selectNodeContents(el);
            range.collapse(false);
            sel.removeAllRanges();
            sel.addRange(range);
          }
        } catch {
          /* ignore */
        }
        if (document.activeElement === el) {
          pendingComposerFocus.current = false;
          return;
        }
      }
      if (attemptsLeft <= 0) {
        pendingComposerFocus.current = false;
        return;
      }
      requestAnimationFrame(() => tryFocus(attemptsLeft - 1));
    };
    // macOS: button click keeps focus on the button until the next tick.
    window.setTimeout(() => tryFocus(12), 0);
  }, []);

  /**
   * Draft new chat (Codex-style): clear UI only.
   * No store row / CLI until first successful send via ensureConnected.
   * Pass `null` for a project-less session (listed under “其他会话”).
   * Omit / pass undefined to use the active project (requires one).
   */
  const newChat = async (
    project?: Project | null,
    opts?: {
      seedDraft?: string;
      switchToChat?: boolean;
      /** Enter conversation-driven scheduled-task setup mode. */
      automationSetup?: boolean;
    },
  ) => {
    // Explicit null → orphan; undefined → fall back to active project.
    const wantOrphan = project === null;
    const proj = wantOrphan ? null : project || activeProject;
    if (!wantOrphan && !proj) {
      setLocalError(tr("project.addSelectFirst"));
      return;
    }
    if (proj && !proj.trusted) {
      setLocalError(tr("project.trustFirst", { name: proj.name }));
      return;
    }
    automationSetupDraftRef.current = !!opts?.automationSetup;
    if (opts?.switchToChat !== false) {
      setMainPane("chat");
      setAppView("workbench");
    }
    setActiveProject(proj);
    if (proj) {
      setExpandedProjects((e) => ({ ...e, [proj.id]: true }));
    } else {
      setHistoryOpen(true);
    }
    // Preserve outgoing thread in cache before clearing the draft UI.
    const leavingId = viewingSessionIdRef.current;
    if (leavingId) {
      const cachedLeaving = messagesBySessionRef.current.get(leavingId);
      if (cachedLeaving) {
        messagesBySessionRef.current.set(leavingId, cachedLeaving);
      }
    }
    viewingSessionIdRef.current = null;
    setMessages([]);
    setContextUsage(INITIAL_CONTEXT_USAGE);
    setDraft(opts?.seedDraft ?? "");
    setAttachments([]);
    setPlan({
      title: "Plan ready for review",
      body: "",
      entries: [],
      waiting: true,
      visible: false,
    });
    setPerm(null);
    setAskUser(null);
    setRetryStatus(null);
    setSession({
      ...IDLE_SNAPSHOT,
      sessionId: null,
      title: tr("session.new"),
      state: "idle",
      backend: "grok_agent_stdio",
    });
    setLocalError(null);
    // Disconnect any live agent for previous session (best-effort).
    if (api.isTauri()) {
      try {
        await api.sessionDisconnect();
        const idle = { ...IDLE_SNAPSHOT };
        setLiveHost(idle);
        liveHostRef.current = idle;
      } catch {
        /* ignore */
      }
    }
    // Focus explicitly — do not rely only on useEffect: after await, effects may
    // already have run, and identical draft/sessionId can skip a re-render.
    requestComposerFocus();
  };

  const sessionsForProject = (projectId: string) =>
    sessions.filter((s) => s.projectId === projectId && !s.archived);

  const orphanSessions = sessions.filter(
    (s) =>
      (!s.projectId || !projects.some((p) => p.id === s.projectId)) &&
      !s.archived,
  );

  /** Archived chats grouped by project for Settings → Archived. */
  const archivedGroups = useMemo(() => {
    const archived = sessions
      .filter((s) => s.archived)
      .slice()
      .sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );
    const byProject = new Map<string | null, SessionRow[]>();
    for (const s of archived) {
      const key =
        s.projectId && projects.some((p) => p.id === s.projectId)
          ? s.projectId
          : null;
      const list = byProject.get(key) ?? [];
      list.push(s);
      byProject.set(key, list);
    }
    const groups: Array<{
      id: string | null;
      name: string;
      sessions: SessionRow[];
    }> = [];
    // Stable order: pin projects list order, then orphan bucket.
    for (const p of projects) {
      const list = byProject.get(p.id);
      if (list?.length) {
        groups.push({ id: p.id, name: p.name, sessions: list });
      }
    }
    const orphan = byProject.get(null);
    if (orphan?.length) {
      groups.push({
        id: null,
        name: tr("settings.archived.orphan"),
        sessions: orphan,
      });
    }
    return groups;
  }, [sessions, projects, tr]);

  /** Session id currently running on the Host (for sidebar spinner). */
  const busySessionId =
    liveHost.sessionId && isSessionBusy(liveHost.state)
      ? liveHost.sessionId
      : null;

  const refreshSessions = async () => {
    try {
      const list = await api.sessionsList();
      setSessions(
        list.map((s) => ({
          id: s.id,
          title: s.title,
          projectId: s.projectId,
          updatedAt: s.updatedAt,
          archived: !!s.archived,
          scheduled: !!s.scheduled,
        })),
      );
      void api.trayRefresh();
    } catch {
      /* ignore */
    }
  };

  /**
   * Run a scheduled automation now: open chat under its project (or orphan),
   * connect, and send the stored prompt.
   * @returns true if the prompt was handed to the agent (mark_run applied).
   */
  const runAutomation = useCallback(
    async (
      auto: Automation,
      opts?: { fromScheduler?: boolean },
    ): Promise<boolean> => {
      if (automationRunLock.current) return false;
      if (opts?.fromScheduler && (session.state === "streaming" || connecting)) {
        return false;
      }
      automationRunLock.current = true;
      let createdSessionId: string | null = null;
      try {
        const proj = auto.projectId
          ? projects.find((p) => p.id === auto.projectId) ?? null
          : null;
        if (proj && !proj.trusted) {
          setLocalError(tr("project.trustFirst", { name: proj.name }));
          return false;
        }
        setMainPane("chat");
        setAppView("workbench");
        setActiveProject(proj);
        if (proj) {
          setExpandedProjects((e) => ({ ...e, [proj.id]: true }));
        } else {
          setHistoryOpen(true);
        }
        openingSessionIdRef.current = null;
        viewingSessionIdRef.current = null;
        setMessages([]);
        setAttachments([]);
        setPerm(null);
        setAskUser(null);
        setRetryStatus(null);
        setLocalError(null);
        setDraft("");
        if (api.isTauri()) {
          try {
            await api.sessionDisconnect();
          } catch {
            /* ignore */
          }
        }
        setSession({
          ...IDLE_SNAPSHOT,
          sessionId: null,
          title: auto.title || tr("session.new"),
          state: "idle",
          backend: "grok_agent_stdio",
        });
        {
          const idle = { ...IDLE_SNAPSHOT };
          setLiveHost(idle);
          liveHostRef.current = idle;
        }

        let sessionId: string | null = null;
        if (api.isTauri()) {
          const meta = (await api.sessionCreate(
            proj?.id,
            auto.title || tr("session.new"),
            { scheduled: true },
          )) as { id: string; title?: string; scheduled?: boolean };
          sessionId = meta.id;
          createdSessionId = meta.id;
          viewingSessionIdRef.current = meta.id;
          setSession((prev) => ({
            ...prev,
            sessionId: meta.id,
            title: meta.title || auto.title,
          }));
          await refreshSessions();
        }

        // Persist model/effort for this session before connect when possible.
        if (sessionId && api.isTauri() && (auto.modelId || auto.effort)) {
          try {
            await api.composerPrefsSet({
              sessionId,
              projectId: proj?.id ?? null,
              modelId: auto.modelId,
              effort: auto.effort,
            });
          } catch {
            /* soft-fail */
          }
        }

        const snap = await api.sessionConnect({
          projectPath: proj?.path,
          sessionId: sessionId ?? undefined,
          mode: "agent",
        });
        setLiveHost(snap);
        liveHostRef.current = snap;
        if (snap.sessionId) {
          viewingSessionIdRef.current = snap.sessionId;
          sessionId = snap.sessionId;
        }
        setSession({
          ...snap,
          title: snap.title || auto.title || snap.title,
        });
        if (snap.lastError || snap.state !== "ready") {
          const code = snap.lastError?.code ?? "AGENT_CRASHED";
          const msg = snap.lastError?.message ?? "connect failed";
          const detail = `${code}: ${msg}`;
          setLocalError(
            tr("automations.connectFailed", { detail }),
          );
          // Drop empty shell sessions so sidebar does not show SuperGrok ghosts.
          if (createdSessionId && api.isTauri()) {
            try {
              await api.sessionDelete(createdSessionId);
              await refreshSessions();
            } catch {
              /* ignore */
            }
            if (viewingSessionIdRef.current === createdSessionId) {
              viewingSessionIdRef.current = null;
              setMessages([]);
              setSession({ ...IDLE_SNAPSHOT, state: "idle" });
            }
          }
          return false;
        }

        if (sessionId && auto.modelId && api.isTauri()) {
          try {
            await api.sessionSetModel(auto.modelId, {
              sessionId,
              projectId: proj?.id ?? null,
            });
          } catch {
            /* soft-fail */
          }
        }

        const header = `[Scheduled: ${auto.title}]\n\n`;
        const promptBody = header + auto.prompt;
        const autoMsgs: ChatMessage[] = [
          {
            id: `u-auto-${Date.now()}`,
            role: "user",
            content: promptBody,
            createdAt: new Date().toISOString(),
          },
        ];
        if (sessionId) {
          messagesBySessionRef.current.set(sessionId, autoMsgs);
        }
        setMessages(autoMsgs);
        setSession((prev) => ({
          ...prev,
          state: "streaming",
          lastError: null,
          title: auto.title || prev.title,
        }));

        try {
          await api.sessionSend(promptBody);
        } catch (sendErr) {
          const errText = String(sendErr);
          const failed: ChatMessage[] = [
            ...autoMsgs,
            {
              id: `err-auto-${Date.now()}`,
              role: "assistant",
              content: errText,
              isError: true,
              createdAt: new Date().toISOString(),
            },
          ];
          if (sessionId) {
            messagesBySessionRef.current.set(sessionId, failed);
          }
          setMessages(failed);
          setLocalError(errText);
          setSession((prev) =>
            prev.sessionId === sessionId
              ? { ...prev, state: "ready" }
              : prev,
          );
          return false;
        }

        const lastRunAt = new Date().toISOString();
        const nextRunAt =
          auto.frequency === "once"
            ? null
            : computeNextRunAt(
                { ...auto, enabled: auto.frequency !== "once" },
                new Date(Date.now() + 60_000),
              );
        await api.automationMarkRun(auto.id, lastRunAt, nextRunAt);
        if (auto.frequency === "once") {
          await api.automationSetEnabled(auto.id, false);
        }
        setToast(tr("automations.runningToast", { title: auto.title }));
        window.setTimeout(() => setToast(null), 3200);
        return true;
      } catch (e) {
        setLocalError(String(e));
        return false;
      } finally {
        automationRunLock.current = false;
      }
    },
    [projects, session.state, connecting, tr],
  );

  // Shell scheduler: poll enabled automations while app is open.
  useEffect(() => {
    if (!api.isTauri() && typeof window === "undefined") return;
    const tick = async () => {
      if (automationRunLock.current || connecting) return;
      if (session.state === "streaming") return;
      try {
        const rows = await api.automationsList();
        const due = rows.find(
          (r) =>
            r.enabled &&
            isDue(r as Automation) &&
            !firedAutomationIds.current.has(`${r.id}:${r.nextRunAt ?? ""}`),
        );
        if (!due) return;
        const fireKey = `${due.id}:${due.nextRunAt ?? ""}`;
        // Claim only after we know we will attempt; release on failure so due tasks retry.
        firedAutomationIds.current.add(fireKey);
        const ok = await runAutomation(due as Automation, {
          fromScheduler: true,
        });
        if (!ok) {
          firedAutomationIds.current.delete(fireKey);
        }
      } catch {
        /* ignore tick errors */
      }
    };
    const id = window.setInterval(() => void tick(), 30_000);
    // First check shortly after mount.
    const boot = window.setTimeout(() => void tick(), 8_000);
    return () => {
      window.clearInterval(id);
      window.clearTimeout(boot);
    };
  }, [runAutomation, connecting, session.state]);

  const refreshProjects = async () => {
    try {
      const list = await api.projectsList();
      setProjects(
        list.map((p) => ({
          ...p,
          pinned: !!p.pinned,
        })),
      );
    } catch {
      /* ignore */
    }
  };

  const applySessionTitle = useCallback(
    (sessionId: string, title: string) => {
      setSessions((list) =>
        list.map((s) => (s.id === sessionId ? { ...s, title } : s)),
      );
      setSession((prev) =>
        prev.sessionId === sessionId ? { ...prev, title } : prev,
      );
      void api.trayRefresh();
    },
    [],
  );

  const renameProject = (proj: Project) => {
    setCtxMenu(null);
    setAppDialog({
      kind: "prompt",
      title: tr("project.rename"),
      initial: proj.name,
      onSubmit: async (name) => {
        const next = name.trim();
        if (!next || next === proj.name) return;
        try {
          await api.projectRename(proj.id, next);
          await refreshProjects();
          void api.trayRefresh();
          if (activeProject?.id === proj.id) {
            setActiveProject((p) => (p ? { ...p, name: next } : p));
          }
        } catch (e) {
          setLocalError(String(e));
        }
      },
    });
  };

  /** Remove project from app list only (disk folder + chats kept). */
  const removeProjectFromApp = (proj: Project) => {
    setCtxMenu(null);
    setAppDialog({
      kind: "confirm",
      title: tr("project.removeTitle"),
      message: tr("project.removeConfirmDetail", { name: proj.name }),
      confirmLabel: tr("project.remove"),
      danger: true,
      onConfirm: async () => {
        try {
          if (!api.isTauri()) {
            setLocalError(tr("error.needTauri"));
            return;
          }
          await api.projectRemove(proj.id);
          if (activeProject?.id === proj.id) {
            setActiveProject(null);
            setSession(IDLE_SNAPSHOT);
            setMessages([]);
          }
          await refreshProjects();
          await refreshSessions();
          setLocalError(null);
        } catch (e) {
          setLocalError(String(e));
        }
      },
    });
  };

  const renameSession = (s: SessionRow) => {
    setCtxMenu(null);
    setAppDialog({
      kind: "prompt",
      title: tr("session.renamePrompt"),
      initial: s.title || tr("session.untitled"),
      placeholder: tr("session.renamePlaceholder"),
      onSubmit: async (title) => {
        const next = title.trim();
        if (!next) return;
        try {
          await api.sessionRename(s.id, next);
          applySessionTitle(s.id, next);
          await refreshSessions();
        } catch (e) {
          setLocalError(String(e));
        }
      },
    });
  };

  /**
   * Archive / unarchive a session.
   * If the open conversation is archived, leave it for a fresh draft so the
   * main pane does not keep showing a chat that disappeared from the tree.
   */
  const archiveSession = async (s: SessionRow, archived = true) => {
    setCtxMenu(null);
    const wasViewing =
      archived &&
      (session.sessionId === s.id || viewingSessionIdRef.current === s.id);
    try {
      await api.sessionSetArchived(s.id, archived);
      await refreshSessions();
      if (wasViewing) {
        const proj = s.projectId
          ? projects.find((p) => p.id === s.projectId) ?? null
          : null;
        // Same project context when possible; orphan → “其他会话” draft.
        if (proj) await newChat(proj, { switchToChat: true });
        else await newChat(null, { switchToChat: true });
      } else if (!archived && s.projectId) {
        setExpandedProjects((e) => ({ ...e, [s.projectId!]: true }));
      }
    } catch (e) {
      setLocalError(String(e));
    }
  };

  /** Permanent delete — confirm first; leave workbench if viewing that chat. */
  const deleteSessionConfirm = (s: SessionRow) => {
    deleteSessionsConfirm([s]);
  };

  /** Bulk restore archived sessions. */
  const restoreSessions = async (rows: SessionRow[]) => {
    if (!rows.length) return;
    try {
      if (!api.isTauri()) {
        setLocalError(tr("error.needTauri"));
        return;
      }
      for (const s of rows) {
        await api.sessionSetArchived(s.id, false);
        if (s.projectId) {
          setExpandedProjects((e) => ({ ...e, [s.projectId!]: true }));
        }
      }
      await refreshSessions();
      setLocalError(null);
    } catch (e) {
      setLocalError(String(e));
    }
  };

  /** Bulk permanent delete with one confirm. */
  const deleteSessionsConfirm = (rows: SessionRow[]) => {
    setCtxMenu(null);
    if (!rows.length) return;
    const n = rows.length;
    const title =
      n === 1
        ? rows[0].title || tr("session.untitled")
        : tr("session.deleteManyTitle");
    const message =
      n === 1
        ? tr("session.deleteConfirm", {
            name: rows[0].title || tr("session.untitled"),
          })
        : tr("session.deleteManyConfirm", { n: String(n) });
    setAppDialog({
      kind: "confirm",
      title: n === 1 ? tr("session.deleteTitle") : title,
      message,
      confirmLabel: tr("session.delete"),
      danger: true,
      onConfirm: async () => {
        try {
          if (!api.isTauri()) {
            setLocalError(tr("error.needTauri"));
            return;
          }
          const openId =
            session.sessionId ?? viewingSessionIdRef.current ?? null;
          const wasViewing = !!openId && rows.some((s) => s.id === openId);
          const viewingRow = wasViewing
            ? rows.find((s) => s.id === openId)
            : null;
          for (const s of rows) {
            await api.sessionDelete(s.id);
            messagesBySessionRef.current.delete(s.id);
          }
          await refreshSessions();
          if (wasViewing && viewingRow) {
            const proj = viewingRow.projectId
              ? projects.find((p) => p.id === viewingRow.projectId) ?? null
              : null;
            if (proj) await newChat(proj, { switchToChat: true });
            else await newChat(null, { switchToChat: true });
          }
          setLocalError(null);
        } catch (e) {
          setLocalError(String(e));
        }
      },
    });
  };

  /** Archive all chats under a project; exit mid-pane if current chat is among them. */
  const archiveProjectSessions = async (proj: Project) => {
    setCtxMenu(null);
    const openId = session.sessionId ?? viewingSessionIdRef.current;
    const openBelongs =
      !!openId &&
      sessions.some((s) => s.id === openId && s.projectId === proj.id);
    try {
      await api.projectArchiveSessions(proj.id);
      await refreshSessions();
      if (openBelongs) {
        await newChat(proj, { switchToChat: true });
      }
    } catch (e) {
      setLocalError(String(e));
    }
  };

  const copySessionId = async (s: SessionRow) => {
    setCtxMenu(null);
    try {
      await navigator.clipboard.writeText(s.id);
    } catch {
      setLocalError(s.id);
    }
  };

  const openSessionMenu = (e: ReactMouseEvent, s: SessionRow) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ kind: "session", id: s.id, x: e.clientX, y: e.clientY });
  };

  const openProjectMenu = (e: ReactMouseEvent, proj: Project) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ kind: "project", id: proj.id, x: e.clientX, y: e.clientY });
  };

  const searchHits = useMemo(
    () =>
      filterSessionSearch(
        searchQuery,
        sessions.map((s) => ({
          id: s.id,
          title: s.title,
          projectId: s.projectId,
          archived: s.archived,
        })),
        projects.map((p) => ({ id: p.id, name: p.name, path: p.path })),
      ),
    [searchQuery, sessions, projects],
  );

  const connPill = useMemo(
    () => connPillForState(session.state, connecting),
    [session.state, connecting],
  );

  const isPlaceholderTitle = useCallback(
    (title: string | undefined | null) => {
      const t = (title || "").trim();
      if (!t) return true;
      const placeholders = [
        tr("session.new"),
        tr("session.placeholderTitle"),
        tr("session.untitled"),
        "New chat",
        "新会话",
        "Untitled",
        "未命名",
      ];
      return placeholders.some((p) => p.toLowerCase() === t.toLowerCase());
    },
    [tr],
  );

  /**
   * Ensure app session row + silent CLI connect.
   * Creates store session only on first send (draft → real).
   * Reconnects when disconnected / crashed. Pass force to tear down a "ready"
   * session that may be wedged (e.g. after a timeout).
   * Returns the live session id when ready, else null.
   *
   * Does not yank the UI if the user already switched to another session while
   * connect is in flight; still updates liveHost so the sidebar spinner tracks work.
   */
  const ensureConnected = async (force = false): Promise<string | null> => {
    // Project-less (orphan) sessions are allowed: cwd falls back on Host.
    if (activeProject && !activeProject.trusted) {
      setLocalError(tr("project.trustFirst", { name: activeProject.name }));
      return null;
    }
    if (!force && session.state === "ready" && !session.lastError && session.sessionId) {
      return session.sessionId;
    }
    if (connecting) return null;
    setConnecting(true);
    // Capture draft identity before awaits (may still be null).
    const viewedBefore = viewingSessionIdRef.current;
    try {
      let sessionId = session.sessionId;
      // First send: materialize draft into a real session (project or orphan).
      if (!sessionId && api.isTauri()) {
        const meta = (await api.sessionCreate(
          activeProject?.id,
          tr("session.new"),
        )) as { id: string; title?: string };
        sessionId = meta.id;
        // Bind draft messages cache to the new id (was under null / unkeyed).
        const draftMsgs = messagesBySessionRef.current.get("__draft__");
        if (draftMsgs?.length) {
          messagesBySessionRef.current.set(meta.id, draftMsgs);
          messagesBySessionRef.current.delete("__draft__");
        }
        // Only take over the workbench if still on this draft / same session.
        if (
          viewingSessionIdRef.current === viewedBefore ||
          viewingSessionIdRef.current === null ||
          viewingSessionIdRef.current === meta.id
        ) {
          viewingSessionIdRef.current = meta.id;
          setSession((prev) => ({
            ...prev,
            sessionId: meta.id,
            title: meta.title || tr("session.new"),
          }));
        }
        if (activeProject) {
          setExpandedProjects((e) => ({ ...e, [activeProject.id]: true }));
        } else {
          setHistoryOpen(true);
        }
        await refreshSessions();
      }
      const snap = await api.sessionConnect({
        projectPath: activeProject?.path,
        sessionId: sessionId ?? undefined,
        mode,
      });
      setLiveHost(snap);
      liveHostRef.current = snap;
      // Only rebind viewed session when the user is still on it (or its draft).
      if (
        snap.sessionId &&
        (viewingSessionIdRef.current === snap.sessionId ||
          viewingSessionIdRef.current === viewedBefore ||
          (viewedBefore === null &&
            viewingSessionIdRef.current === snap.sessionId))
      ) {
        viewingSessionIdRef.current = snap.sessionId;
        setSession(snap);
      }
      if (snap.lastError || snap.state !== "ready") {
        const code = snap.lastError?.code ?? "AGENT_CRASHED";
        const msg = snap.lastError?.message ?? "connect failed";
        if (viewingSessionIdRef.current === (snap.sessionId || sessionId)) {
          setLocalError(`${code}: ${msg}`);
        }
        return null;
      }
      if (viewingSessionIdRef.current === (snap.sessionId || sessionId)) {
        setLocalError(null);
      }
      return snap.sessionId || sessionId || null;
    } catch (e) {
      if (
        viewingSessionIdRef.current === viewedBefore ||
        viewingSessionIdRef.current === session.sessionId
      ) {
        setLocalError(String(e));
      }
      return null;
    } finally {
      setConnecting(false);
    }
  };

  const attachLabels = useMemo(
    () => ({
      open: tr("attach.open"),
      reveal: tr("attach.reveal"),
      copyPath: tr("attach.copyPath"),
      copyImage: tr("attach.copyImage"),
      addToComposer: tr("attach.addToComposer"),
      remove: tr("composer.attachRemove"),
      viewImage: tr("image.view"),
    }),
    [tr],
  );

  const lastUserMessageId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.role === "user") return messages[i]!.id;
    }
    return null;
  }, [messages]);

  const canEditLastUser =
    !!lastUserMessageId &&
    canSend(session.state) &&
    !connecting &&
    session.state !== "streaming" &&
    session.state !== "awaiting_permission";

  /** Idle-ish: allow fork / rewind from transcript (not mid-turn). */
  const canRewindSession =
    canSend(session.state) &&
    !connecting &&
    !editSubmitting &&
    !rewindBusy;

  const send = async () => {
    const segments = parseStoredContent(draft);
    const storedDisplay = draft; // keep skill tokens in UI history
    const att = attachments;
    if (
      (isDraftEmpty(segments) && !att.length) ||
      !canSend(session.state) ||
      connecting
    ) {
      return;
    }
    const agentBody = serializeForAgent(segments, { goalMode });
    let agentText = buildAgentPrompt(agentBody, att);
    const scheduleIntent = looksLikeScheduleIntent(agentText);
    const inAutomationSetup =
      automationSetupDraftRef.current ||
      scheduleIntent ||
      (!!session.sessionId &&
        automationSetupSessionsRef.current.has(session.sessionId));
    if (inAutomationSetup) {
      agentText = wrapAutomationSetupAgentText(agentText);
    }
    const titleSeed =
      serializeForAgent(segments).replace(/\n/g, " ").trim() ||
      att.map((a) => a.name).join(", ");
    const shouldAutoTitle = isPlaceholderTitle(session.title) || !session.sessionId;
    const pendingAssistantId = `a-pending-${Date.now()}`;
    const sendTargetId = session.sessionId;
    const cacheKey = sendTargetId ?? "__draft__";

    // New composer send is never edit-resend (edit is inline on the message).
    if (editingUserMessageId) {
      setEditingUserMessageId(null);
      setEditAttachments([]);
    }

    setDraft("");
    setSlashQuery(null);
    setAttachments([]);
    setRetryStatus(null);
    // Reset editor height after clear
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(".composer__input");
      if (el) {
        el.style.height = "auto";
      }
    });
    // Optimistic: user bubble + chat thinking; connection stays silent (no top-bar chip)
    // Write cache immediately so a fast session switch does not drop the user turn.
    // Clear any stuck streaming flags on prior turns so the next stream cannot
    // append onto an old assistant (duplicate-history reports).
    const nowIso = new Date().toISOString();
    setMessages((m) => {
      const cleaned = clearPriorTurnStreaming(m);
      const next: ChatMessage[] = [
        ...cleaned,
        {
          id: `u-${Date.now()}`,
          role: "user",
          content: storedDisplay,
          attachments: att.length ? att : undefined,
          createdAt: nowIso,
        },
        {
          id: pendingAssistantId,
          role: "assistant",
          content: "",
          streaming: true,
        },
      ];
      messagesBySessionRef.current.set(cacheKey, next);
      return next;
    });
    setSession((prev) =>
      prev.state === "streaming" || prev.state === "awaiting_permission"
        ? prev
        : { ...prev, state: "streaming", lastError: null },
    );
    setTurnStartedAt(Date.now());
    // Reflect optimistic busy on live host for sidebar spinner (until real state arrives).
    setLiveHost((prev) => {
      if (sendTargetId && prev.sessionId && prev.sessionId !== sendTargetId) {
        return prev;
      }
      const next = {
        ...prev,
        sessionId: sendTargetId ?? prev.sessionId,
        state: "streaming" as const,
        lastError: null,
      };
      liveHostRef.current = next;
      return next;
    });
    try {
      const sessionId = await ensureConnected();
      if (!sessionId) {
        // Keep user message; drop optimistic thinking bubble
        patchSessionMessages(sendTargetId ?? viewingSessionIdRef.current, (m) =>
          m.filter((x) => x.id !== pendingAssistantId),
        );
        // Also clear draft cache key if we never got an id
        if (!sendTargetId) {
          const draft = messagesBySessionRef.current.get("__draft__");
          if (draft) {
            messagesBySessionRef.current.set(
              "__draft__",
              draft.filter((x) => x.id !== pendingAssistantId),
            );
          }
        }
        if (
          viewingSessionIdRef.current === sendTargetId ||
          (!sendTargetId && viewingSessionIdRef.current === null)
        ) {
          setSession((prev) =>
            prev.state === "streaming"
              ? { ...prev, state: prev.sessionId ? "ready" : prev.state }
              : prev,
          );
        }
        return;
      }
      // Move draft cache onto the real session id if this was first send.
      if (!sendTargetId) {
        const draftMsgs = messagesBySessionRef.current.get("__draft__");
        if (draftMsgs?.length) {
          messagesBySessionRef.current.set(sessionId, draftMsgs);
          messagesBySessionRef.current.delete("__draft__");
        }
      }
      if (
        automationSetupDraftRef.current ||
        inAutomationSetup
      ) {
        automationSetupSessionsRef.current.add(sessionId);
        automationSetupDraftRef.current = false;
      }
      // Journal stores display form (skill chips); agent receives serialized prompt.
      await api.sessionSend(agentText, storedDisplay);
      if (shouldAutoTitle && api.isTauri()) {
        void api
          .sessionAutoTitle(sessionId, titleSeed)
          .then((meta) => {
            if (meta?.title) applySessionTitle(sessionId, meta.title);
          })
          .catch(() => {
            /* heuristic may still land; ignore refine errors */
          });
      }
    } catch (e) {
      const errTarget = sendTargetId ?? viewingSessionIdRef.current;
      patchSessionMessages(errTarget, (m) =>
        m.filter((x) => x.id !== pendingAssistantId),
      );
      if (
        viewingSessionIdRef.current === sendTargetId ||
        viewingSessionIdRef.current === errTarget
      ) {
        setSession((prev) =>
          prev.state === "streaming"
            ? { ...prev, state: prev.sessionId ? "ready" : prev.state }
            : prev,
        );
        setLocalError(String(e));
      }
    }
  };

  const addAttachmentsFromPaths = useCallback(
    async (paths: string[]) => {
      if (!paths.length) {
        setLocalError(tr("attach.droppedNone"));
        return;
      }
      // While inline-editing a sent message, drops target the edit form — not the composer.
      const intoEdit = !!editingUserMessageIdRef.current;
      const mergeInto = intoEdit ? setEditAttachments : setAttachments;
      try {
        if (!api.isTauri()) {
          mergeInto((prev) =>
            mergeAttachments(
              prev,
              paths.map((p) => ({
                path: p,
                name: p.split(/[/\\]/).pop() || p,
                isDir: false,
              })),
            ),
          );
          return;
        }
        const classified = await api.pathsClassify(paths);
        // Accept all formats (images, docs, …). Keep entries even if exists is false
        // so transient sandbox / iCloud paths still show; open may fail later.
        const next = classified.map((c) => ({
          path: c.path,
          name: c.name,
          isDir: c.isDir,
        }));
        if (!next.length) {
          setLocalError(tr("attach.droppedNone"));
          return;
        }
        mergeInto((prev) => mergeAttachments(prev, next));
        setLocalError(null);
      } catch (e) {
        setLocalError(String(e));
      }
    },
    [tr],
  );

  /** Web File list (paste / HTML5 drop) → absolute paths for agent `@path`. */
  const addAttachmentsFromFiles = useCallback(
    async (files: File[]) => {
      if (!files.length) return;
      const withPath: string[] = [];
      const withoutPath: File[] = [];
      for (const f of files) {
        const anyF = f as File & { path?: string };
        if (anyF.path) withPath.push(anyF.path);
        else withoutPath.push(f);
      }
      if (withPath.length) {
        await addAttachmentsFromPaths(withPath);
      }
      if (!withoutPath.length) return;
      if (!api.isTauri()) {
        setLocalError(tr("composer.attachPasteFailed"));
        return;
      }
      const intoEdit = !!editingUserMessageIdRef.current;
      const mergeInto = intoEdit ? setEditAttachments : setAttachments;
      try {
        for (const f of withoutPath) {
          const buf = await f.arrayBuffer();
          const bytes = new Uint8Array(buf);
          // Chunked base64 to avoid call-stack limits on large pastes
          let binary = "";
          const chunk = 0x8000;
          for (let i = 0; i < bytes.length; i += chunk) {
            binary += String.fromCharCode(
              ...bytes.subarray(i, Math.min(i + chunk, bytes.length)),
            );
          }
          const b64 = btoa(binary);
          const name =
            f.name && f.name !== "image.png" && f.name !== "blob"
              ? f.name
              : f.type?.startsWith("image/")
                ? `paste.${(f.type.split("/")[1] || "png").replace("jpeg", "jpg")}`
                : f.name || "paste.bin";
          const entry = await api.saveTempAttachment(b64, name, f.type || null);
          mergeInto((prev) =>
            mergeAttachments(prev, [
              {
                path: entry.path,
                name: entry.name,
                isDir: entry.isDir,
              },
            ]),
          );
        }
        setLocalError(null);
      } catch (e) {
        setLocalError(String(e) || tr("composer.attachPasteFailed"));
      }
    },
    [addAttachmentsFromPaths, tr],
  );

  const closeComposerMenu = useCallback(() => {
    const live = liveSlashRef.current;
    if (live.present) {
      slashDismissedSigRef.current = `${live.start}:${live.query}`;
    }
    setShowComposerPlus(false);
    setSlashQuery(null);
    const cleared = { present: false, query: "", start: 0, end: 0 };
    setLiveSlash(cleared);
    liveSlashRef.current = cleared;
  }, []);

  /** Stable slash-query setter: skip no-op updates so filter effects don't thrash. */
  const onSlashQueryChange = useCallback(
    (q: { start: number; query: string; end: number } | null) => {
      setSlashQuery((prev) => {
        if (q == null) return prev == null ? prev : null;
        if (
          prev &&
          prev.start === q.start &&
          prev.query === q.query &&
          prev.end === q.end
        ) {
          return prev;
        }
        return q;
      });
    },
    [],
  );

  const pickComposerFiles = useCallback(async () => {
    closeComposerMenu();
    if (!api.isTauri()) {
      setLocalError(tr("composer.attachPasteFailed"));
      return;
    }
    try {
      const paths = await api.pickAttachFiles();
      if (!paths.length) return;
      await addAttachmentsFromPaths(paths);
    } catch (e) {
      setLocalError(String(e));
    }
  }, [addAttachmentsFromPaths, closeComposerMenu, tr]);

  const addProjectsFromPaths = useCallback(
    async (paths: string[]) => {
      if (!paths.length || !api.isTauri()) return;
      try {
        const classified = await api.pathsClassify(paths);
        const dirs = classified.filter((c) => c.exists && c.isDir);
        if (!dirs.length) {
          setLocalError(tr("composer.dropProjectFilesOnly"));
          return;
        }
        let last: Project | null = null;
        for (const d of dirs) {
          last = (await api.projectAdd(d.path, false)) as Project;
        }
        const list = (await api.projectsList()) as Project[];
        setProjects(list);
        if (last) {
          setActiveProject(list.find((p) => p.id === last!.id) ?? last);
          setExpandedProjects((e) => ({ ...e, [last!.id]: true }));
          setLocalError(null);
          setToast(tr("composer.projectAdded", { name: last.name }));
          window.setTimeout(() => setToast(null), 2500);
        }
      } catch (e) {
        setLocalError(String(e));
      }
    },
    [tr],
  );

  /**
   * Hit-test CSS client point against the live sidebar box.
   * Only the real left rail is "sidebar" (add project); rest of workbench is attach.
   */
  const hitDragZone = useCallback(
    (clientX: number, clientY: number): "sidebar" | "main" => {
      const collapsed = layoutRef.current.sidebarCollapsed;
      if (collapsed) return "main";
      const el = querySidebarEl();
      if (!el) return "main";
      return hitDragZoneFromRects(
        clientX,
        clientY,
        el.getBoundingClientRect(),
        false,
      );
    },
    [],
  );

  // Tauri OS file drag-drop (full absolute paths)
  useEffect(() => {
    if (!api.isTauri()) return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    void (async () => {
      try {
        const { getCurrentWebview } = await import("@tauri-apps/api/webview");
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const webview = getCurrentWebview();
        const win = getCurrentWindow();
        const factor = await win.scaleFactor();

        unlisten = await webview.onDragDropEvent((event) => {
          if (cancelled) return;
          const payload = event.payload;
          if (payload.type === "enter" || payload.type === "drop") {
            if ("paths" in payload && payload.paths?.length) {
              dragPathsRef.current = payload.paths;
            }
          }
          if (payload.type === "leave") {
            setDragZone(null);
            dragPathsRef.current = [];
            return;
          }
          if (payload.type === "enter" || payload.type === "over") {
            // macOS: coords are already view points; win: physical → / factor
            const { x, y } = toClientDragPoint(
              payload.position,
              factor,
              platform,
            );
            setDragZone(hitDragZone(x, y));
            return;
          }
          if (payload.type === "drop") {
            const { x, y } = toClientDragPoint(
              payload.position,
              factor,
              platform,
            );
            const zone = hitDragZone(x, y);
            const paths = payload.paths?.length
              ? payload.paths
              : dragPathsRef.current;
            setDragZone(null);
            dragPathsRef.current = [];
            if (!paths.length) {
              setLocalError(tr("attach.droppedNone"));
              return;
            }
            if (zone === "sidebar") {
              void addProjectsFromPaths(paths);
            } else {
              // All file types (images, pdf, …) attach in main zone
              void addAttachmentsFromPaths(paths);
            }
          }
        });
      } catch {
        /* webview API unavailable */
      }
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [
    addAttachmentsFromPaths,
    addProjectsFromPaths,
    hitDragZone,
    platform,
    tr,
  ]);

  // HTML5 fallback: some image drags only expose File list in the webview.
  // Prefer Tauri paths; use File.path when present (Tauri webview).
  useEffect(() => {
    const onDragOver = (e: DragEvent) => {
      if (!e.dataTransfer?.types?.includes("Files")) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    };
    const onDrop = (e: DragEvent) => {
      if (!e.dataTransfer?.files?.length) return;
      // If Tauri already handled this OS drop, paths may be empty here.
      const files = Array.from(e.dataTransfer.files);
      const paths = files
        .map((f) => {
          const anyF = f as File & { path?: string };
          return anyF.path || "";
        })
        .filter(Boolean);
      const zone = hitDragZone(e.clientX, e.clientY);
      if (paths.length) {
        e.preventDefault();
        e.stopPropagation();
        if (zone === "sidebar") void addProjectsFromPaths(paths);
        else void addAttachmentsFromPaths(paths);
        return;
      }
      // Browser-only / path-less File list (e.g. image from another app)
      if (zone !== "sidebar" && files.length) {
        e.preventDefault();
        e.stopPropagation();
        void addAttachmentsFromFiles(files);
      }
    };
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
    };
  }, [
    addAttachmentsFromFiles,
    addAttachmentsFromPaths,
    addProjectsFromPaths,
    hitDragZone,
  ]);

  // Drag-resize right resource pane
  useEffect(() => {
    if (!resizingAside) return;
    const onMove = (e: PointerEvent) => {
      const next = clampAsideWidth(window.innerWidth - e.clientX);
      setLayout((l) => {
        const n = { ...l, asideWidth: next, asideCollapsed: false };
        return n;
      });
    };
    const onUp = () => {
      setResizingAside(false);
      setLayout((l) => {
        saveLayout(localStorage, l);
        return l;
      });
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [resizingAside]);

  const resizeComposer = (el: HTMLElement) => {
    const line = 22; // ~line-height
    const min = line * 1;
    const max = line * 10;
    el.style.height = "auto";
    el.style.height = `${Math.min(Math.max(el.scrollHeight, min), max)}px`;
  };

  /** Programmatic draft / layout changes: recompute height after paint. */
  const syncComposerHeight = useCallback(() => {
    // Double rAF: wait for React commit + layout after mainPane switch.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const node = composerInputRef.current;
        if (node) resizeComposer(node);
      });
    });
  }, []);

  // Load skills catalog for slash palette (Grok inspect).
  useEffect(() => {
    if (!api.isTauri()) return;
    let cancelled = false;
    setSkillsLoading(true);
    void api
      .skillsList(activeProject?.path ?? null)
      .then((res) => {
        if (cancelled) return;
        setSkillInfos(
          (res.skills ?? []).map((s) => ({
            name: s.name,
            description: s.description ?? "",
            source: s.source,
            userInvocable: s.userInvocable,
          })),
        );
      })
      .catch(() => {
        if (!cancelled) setSkillInfos([]);
      })
      .finally(() => {
        if (!cancelled) setSkillsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeProject?.path]);

  const slashCatalog = useMemo(
    () => buildSlashCatalog(skillInfos),
    [skillInfos],
  );
  const resolveSlashTitle = useCallback(
    (item: SlashItem) => {
      if (item.titleKey) {
        try {
          return tr(item.titleKey as MessageKey);
        } catch {
          /* fall through */
        }
      }
      return item.displayTitle || item.name;
    },
    [tr],
  );
  const resolveSlashDescription = useCallback(
    (item: SlashItem) => {
      if (item.descriptionKey) {
        try {
          return tr(item.descriptionKey as MessageKey);
        } catch {
          /* fall through */
        }
      }
      return item.displayDescription || "";
    },
    [tr],
  );
  /** Filter query from live editor poll only. */
  const slashFilterQuery = liveSlash.present ? liveSlash.query : "";

  /** Shared filter for + menu and `/` slash — empty query = full catalog. */
  const slashFiltered = useMemo(
    () =>
      flattenFilteredCatalog(slashCatalog, slashFilterQuery, (item) => ({
        title: resolveSlashTitle(item),
        description: resolveSlashDescription(item),
      })),
    [
      slashCatalog,
      slashFilterQuery,
      resolveSlashTitle,
      resolveSlashDescription,
    ],
  );
  const showUploadInMenu = useMemo(
    () =>
      uploadMatchesQuery(slashFilterQuery, {
        title: tr("composer.addFiles"),
        hint: tr("composer.addFilesHint"),
      }),
    [slashFilterQuery, tr],
  );
  const composerMenuEntries = useMemo(
    () =>
      buildComposerPlusEntries({
        showUpload: showUploadInMenu,
        commands: slashFiltered.commands,
        skills: slashFiltered.skills,
      }),
    [showUploadInMenu, slashFiltered.commands, slashFiltered.skills],
  );
  const composerMenuEntriesRef = useRef(composerMenuEntries);
  composerMenuEntriesRef.current = composerMenuEntries;

  /** + button and `/` open the same panel. */
  const composerMenuOpen = showComposerPlus || liveSlash.present;

  /**
   * rAF poll of composer innerText → live slash token.
   * Single source of truth for open state + filter (not React draft).
   */
  useEffect(() => {
    let raf = 0;
    let alive = true;
    const tick = () => {
      if (!alive) return;
      const el = composerInputRef.current;
      const detected = detectSlashQueryFromEditor(el);
      let next = detected
        ? {
            present: true as const,
            query: detected.query,
            start: detected.start,
            end: detected.end,
          }
        : {
            present: false as const,
            query: "",
            start: 0,
            end: 0,
          };
      // Honor Escape dismiss until the user edits the `/token`.
      if (next.present && slashDismissedSigRef.current != null) {
        const sig = `${next.start}:${next.query}`;
        if (sig === slashDismissedSigRef.current) {
          next = { present: false, query: "", start: 0, end: 0 };
        } else {
          slashDismissedSigRef.current = null;
        }
      }
      if (!next.present && detected == null) {
        slashDismissedSigRef.current = null;
      }
      const prev = liveSlashRef.current;
      if (
        prev.present !== next.present ||
        prev.query !== next.query ||
        prev.start !== next.start ||
        prev.end !== next.end
      ) {
        liveSlashRef.current = next;
        setLiveSlash(next);
        if (next.present) {
          setSlashQuery({
            start: next.start,
            query: next.query,
            end: next.end,
          });
        } else if (!showComposerPlusRef.current) {
          setSlashQuery((q) => (q == null ? q : null));
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
    };
  }, []);

  /** Pin above input card; width matches composer shell.
   * Re-anchor when filter results change height (short list must sit on input). */
  const { pos: composerPlusPos, style: composerPlusStyle } = useFloatingMenu({
    open: composerMenuOpen,
    triggerRef: composerShellRef,
    panelRef: composerPlusPanelRef,
    roots: [composerPlusTriggerRef, composerShellRef, composerInputRef],
    onClose: closeComposerMenu,
    placement: "up",
    fitContent: false,
    matchTriggerWidth: true,
    minWidth: 280,
    estHeight: 220,
    gap: 8,
    deps: [slashFilterQuery, composerMenuEntries.length],
  });

  // Reset highlight only when the filter *string* changes.
  const prevFilterQueryRef = useRef(slashFilterQuery);
  useEffect(() => {
    if (prevFilterQueryRef.current === slashFilterQuery) return;
    prevFilterQueryRef.current = slashFilterQuery;
    setSlashActiveIndex(0);
  }, [slashFilterQuery]);

  // Keep highlight in range when the filtered list shrinks (no forced 0).
  useEffect(() => {
    setSlashActiveIndex((i) => {
      if (composerMenuEntries.length === 0) return 0;
      return i >= composerMenuEntries.length
        ? composerMenuEntries.length - 1
        : i;
    });
  }, [composerMenuEntries.length]);

  const openMcpModal = useCallback(async () => {
    setShowMcpModal(true);
    setMcpLoading(true);
    setMcpError(null);
    try {
      const res = await api.inspectMcp(activeProject?.path ?? null);
      setMcpServers(res.servers ?? []);
      if (res.error) setMcpError(res.error);
    } catch (e) {
      setMcpServers([]);
      setMcpError(String(e));
    } finally {
      setMcpLoading(false);
    }
  }, [activeProject?.path]);

  const showToast = useCallback((msg: string, ms = 3200) => {
    setToast(msg);
    window.setTimeout(() => {
      setToast((cur) => (cur === msg ? null : cur));
    }, ms);
  }, []);

  /**
   * Fork a session (full history or through a user-prompt index) and open it.
   */
  const runForkSession = useCallback(
    async (
      source: SessionRow,
      opts?: { throughUserPromptIndex?: number | null },
    ) => {
      if (!api.isTauri()) {
        showToast(tr("error.needTauri"));
        return;
      }
      try {
        const base = (source.title || tr("session.untitled")).trim();
        // Avoid double-prefix when forking a fork (any locale).
        const title = /^(fork of|分叉：|分叉:)\s*/i.test(base)
          ? base
          : tr("session.forkTitleOf", { name: base || "chat" });
        const meta = await api.sessionFork(source.id, {
          throughUserPromptIndex: opts?.throughUserPromptIndex ?? null,
          title,
        });
        await refreshSessions();
        const row: SessionRow = {
          id: meta.id,
          title: meta.title || title,
          projectId: meta.projectId ?? source.projectId,
          updatedAt: meta.updatedAt || new Date().toISOString(),
          archived: meta.archived,
          scheduled: meta.scheduled,
        };
        const proj = row.projectId
          ? projects.find((p) => p.id === row.projectId) ?? null
          : null;
        if (row.projectId) {
          setExpandedProjects((e) => ({ ...e, [row.projectId!]: true }));
        } else {
          setHistoryOpen(true);
        }
        await openSession(row, proj);
        showToast(tr("session.forkOk"), 2800);
      } catch (e) {
        showToast(tr("session.forkFailed") + ": " + String(e), 4500);
      }
    },
    // openSession / refreshSessions via closure
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projects, showToast, tr],
  );

  const confirmForkSession = useCallback(
    (source: SessionRow, throughUserPromptIndex?: number | null) => {
      setCtxMenu(null);
      const partial =
        throughUserPromptIndex != null && throughUserPromptIndex !== undefined;
      setAppDialog({
        kind: "confirm",
        title: tr("session.forkTitle"),
        message: partial
          ? tr("session.forkConfirmPartial")
          : tr("session.forkConfirm"),
        confirmLabel: tr("session.fork"),
        onConfirm: () => {
          void runForkSession(source, {
            throughUserPromptIndex: throughUserPromptIndex ?? null,
          });
        },
      });
    },
    [runForkSession, tr],
  );

  /**
   * Apply rewind: truncate local journal (+ agent when live), refresh messages UI.
   */
  const runRewindToPrompt = useCallback(
    async (sessionId: string, targetPromptIndex: number) => {
      if (!api.isTauri()) {
        showToast(tr("error.needTauri"));
        return;
      }
      if (!canRewindSession) {
        showToast(tr("session.rewindBusy"));
        return;
      }
      setRewindBusy(true);
      try {
        // Prefer live connect so agent rewind can run; local truncate still works if not.
        if (
          (session.sessionId === sessionId ||
            viewingSessionIdRef.current === sessionId) &&
          session.state !== "ready"
        ) {
          try {
            await ensureConnected();
          } catch {
            /* local-only path */
          }
        }

        const result = await api.sessionRewindExecute(targetPromptIndex, {
          sessionId,
          restoreFiles: false,
        });

        // Refresh UI from truncated journal.
        if (viewingSessionIdRef.current === sessionId) {
          const stored = await api.sessionMessages(sessionId);
          const mapped: ChatMessage[] = stored.map((m) => ({
            id: m.id,
            role: m.role as "user" | "assistant" | "tool",
            content: m.content,
            thought: m.thought ?? undefined,
            thoughtPhases: splitThoughtPhases(m.thought),
            isError: m.isError || undefined,
            marker: m.marker || undefined,
            createdAt: m.createdAt || undefined,
            attachments: (m.attachments ?? []).map((a) => ({
              path: a.path,
              name: a.name || a.path.split(/[/\\]/).pop() || a.path,
              isDir: !!a.isDir,
            })),
            streaming: false,
          }));
          const kept = truncateThroughUserPrompt(mapped, targetPromptIndex);
          const finalMsgs =
            kept.length || mapped.length <= result.keptCount
              ? kept.length
                ? kept
                : mapped
              : mapped.slice(0, result.keptCount);
          messagesBySessionRef.current.set(sessionId, finalMsgs);
          setMessages(finalMsgs);
        } else {
          messagesBySessionRef.current.delete(sessionId);
        }

        setRewindTimeline(null);
        if (result.agentOk) {
          showToast(tr("session.rewindOk"), 2600);
        } else {
          showToast(tr("session.rewindLocalOnly"), 4200);
        }
        await refreshSessions();
      } catch (e) {
        showToast(tr("session.rewindFailed") + ": " + String(e), 4500);
      } finally {
        setRewindBusy(false);
      }
    },
    // ensureConnected / refreshSessions via closure
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canRewindSession, session.sessionId, session.state, showToast, tr],
  );

  const confirmRewindToPrompt = useCallback(
    (sessionId: string, targetPromptIndex: number, preview?: string) => {
      setCtxMenu(null);
      const msgPreview = preview?.trim()
        ? `\n\n“${preview.trim()}”`
        : "";
      setAppDialog({
        kind: "confirm",
        title: tr("session.rewindTitle"),
        message: tr("session.rewindConfirm") + msgPreview,
        confirmLabel: tr("session.rewindConfirmLabel"),
        danger: true,
        onConfirm: () => {
          void runRewindToPrompt(sessionId, targetPromptIndex);
        },
      });
    },
    [runRewindToPrompt, tr],
  );

  const openRewindTimeline = useCallback(
    async (sessionId: string) => {
      setCtxMenu(null);
      if (!api.isTauri()) {
        showToast(tr("error.needTauri"));
        return;
      }
      if (!canRewindSession) {
        showToast(tr("session.rewindBusy"));
        return;
      }
      try {
        let points = await api.sessionRewindPoints(sessionId);
        if (!points.length) {
          if (viewingSessionIdRef.current === sessionId) {
            points = localRewindPoints(messagesRef.current).map((p) => ({
              promptIndex: p.promptIndex,
              messageId: p.messageId,
              preview: p.preview,
            }));
          }
        }
        if (!points.length) {
          showToast(tr("session.rewindEmpty"));
          return;
        }
        setRewindTimeline({ sessionId, points });
      } catch (e) {
        if (viewingSessionIdRef.current === sessionId) {
          const points = localRewindPoints(messagesRef.current);
          if (points.length) {
            setRewindTimeline({
              sessionId,
              points: points.map((p) => ({
                promptIndex: p.promptIndex,
                messageId: p.messageId,
                preview: p.preview,
              })),
            });
            return;
          }
        }
        showToast(tr("session.rewindFailed") + ": " + String(e), 4500);
      }
    },
    [canRewindSession, showToast, tr],
  );

  const onRewindToUserMessage = useCallback(
    (msg: ChatMessage) => {
      const sid = session.sessionId ?? viewingSessionIdRef.current;
      if (!sid) {
        showToast(tr("session.rewindFailed"));
        return;
      }
      if (!canRewindSession) {
        showToast(tr("session.rewindBusy"));
        return;
      }
      const idx = userPromptIndexOf(messages, msg.id);
      if (idx < 0) return;
      if (!canRewindToUserPrompt(messages, idx)) {
        showToast(tr("session.rewindNoop"));
        return;
      }
      const preview = (msg.content || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 80);
      confirmRewindToPrompt(sid, idx, preview);
    },
    [
      canRewindSession,
      confirmRewindToPrompt,
      messages,
      session.sessionId,
      showToast,
      tr,
    ],
  );

  const onForkFromUserMessage = useCallback(
    (msg: ChatMessage) => {
      const sid = session.sessionId ?? viewingSessionIdRef.current;
      if (!sid) {
        showToast(tr("session.forkFailed"));
        return;
      }
      const row =
        sessions.find((s) => s.id === sid) ??
        ({
          id: sid,
          title: session.title || tr("session.untitled"),
          projectId: activeProject?.id ?? null,
          updatedAt: new Date().toISOString(),
        } satisfies SessionRow);
      const idx = userPromptIndexOf(messages, msg.id);
      if (idx < 0) return;
      confirmForkSession(row, idx);
    },
    [
      activeProject?.id,
      confirmForkSession,
      messages,
      session.sessionId,
      session.title,
      sessions,
      showToast,
      tr,
    ],
  );

  /**
   * Apply permission policy (incl. YOLO). Never use window.confirm in Tauri —
   * it is unreliable in the WebView and blocks YOLO enable/disable.
   */
  const applyPermissionPolicy = useCallback(
    (next: PermissionPolicyId, opts?: { toastYoloToggle?: boolean }) => {
      if (!isValidPolicy(next)) return;

      const commit = () => {
        setPolicy(next);
        void api
          .sessionSetPolicy(next, {
            projectId: activeProject?.id ?? null,
            sessionId: session.sessionId ?? null,
          })
          .catch((e) => showToast(String(e), 4000));
        if (opts?.toastYoloToggle) {
          showToast(
            next === "always_approve"
              ? tr("slash.yoloOn")
              : tr("slash.yoloOff"),
            2500,
          );
        }
      };

      if (next !== "always_approve") {
        commit();
        return;
      }

      // Two-step in-app confirm (dangerous YOLO).
      setAppDialog({
        kind: "confirm",
        title: tr("policy.always_approve"),
        message: tr("policy.yoloConfirm"),
        confirmLabel: tr("common.confirm"),
        danger: true,
        onConfirm: () => {
          setAppDialog({
            kind: "confirm",
            title: tr("policy.always_approve"),
            message: tr("policy.yoloConfirm2"),
            confirmLabel: tr("policy.short.always_approve"),
            danger: true,
            onConfirm: commit,
          });
        },
      });
    },
    [activeProject?.id, session.sessionId, showToast, tr],
  );

  const applySlashItem = useCallback(
    (item: SlashItem) => {
      const live = liveSlashRef.current;
      const q =
        slashQuery ??
        (live.present
          ? { start: live.start, query: live.query, end: live.end }
          : null);
      setSlashQuery(null);
      setLiveSlash({ present: false, query: "", start: 0, end: 0 });
      liveSlashRef.current = { present: false, query: "", start: 0, end: 0 };
      setShowComposerPlus(false);

      if (item.kind === "skill") {
        if (q) {
          setDraft((d) => applySkillAtSlash(d, q.start, q.end, item.name));
        } else {
          setDraft((d) => {
            const needsSpace = d.length > 0 && !/\s$/.test(d);
            return `${d}${needsSpace ? " " : ""}[[skill:${item.name}]] `;
          });
        }
        return;
      }

      // Remove the /query from draft for mode/action
      if (q) {
        setDraft((d) => d.slice(0, q.start) + d.slice(q.end));
      }

      if (item.kind === "mode") {
        if (item.mode === "goal") {
          setGoalMode(true);
          if (mode === "plan") setMode("agent");
          return;
        }
        if (item.mode === "plan") {
          setGoalMode(false);
          setMode("plan");
          void api
            .composerPrefsSet({
              projectId: activeProject?.id ?? null,
              sessionId: session.sessionId ?? null,
              mode: "plan",
            })
            .catch((e) => showToast(String(e), 4000));
          return;
        }
      }

      if (item.kind === "action") {
        switch (item.action) {
          case "doctor":
            openDoctor();
            return;
          case "status":
            setShowStatusModal(true);
            return;
          case "mcp":
            void openMcpModal();
            return;
          case "compact":
            setCompactNote("");
            setShowCompactModal(true);
            return;
          case "newChat":
            void newChat();
            return;
          case "automations":
            navigateAutomations();
            return;
          case "settings":
            navigateSettings("general");
            return;
          case "yolo": {
            const next: PermissionPolicyId =
              policy === "always_approve" ? "ask" : "always_approve";
            applyPermissionPolicy(next, { toastYoloToggle: true });
            return;
          }
          default:
            return;
        }
      }
    },
    // many deps — intentionally broad for stable handlers used in render
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      slashQuery,
      mode,
      policy,
      activeProject?.id,
      session.sessionId,
      tr,
      openMcpModal,
      applyPermissionPolicy,
      showToast,
    ],
  );

  // Seed draft / clear / pane switch: grow textarea. If a focus request is still
  // pending (e.g. textarea just remounted), retry focus here as a backstop.
  useEffect(() => {
    if (mainPane !== "chat") return;
    if (pendingComposerFocus.current) {
      requestComposerFocus();
      return;
    }
    syncComposerHeight();
  }, [draft, mainPane, session.sessionId, requestComposerFocus, syncComposerHeight]);

  /** Context usage chip label/state from compact events + message estimate. */
  const contextUsageDisplay = useMemo(
    () => resolveContextUsageDisplay(contextUsage, messages),
    [contextUsage, messages],
  );

  /**
   * New empty draft only: lift composer and SuperGrok brand.
   * Existing sessions (even with empty journal) must not look like a fresh chat.
   */
  const welcomeSession =
    mainPane === "chat" &&
    !session.sessionId &&
    messages.length === 0 &&
    session.state !== "streaming";
  const emptyExistingSession =
    mainPane === "chat" &&
    !!session.sessionId &&
    messages.length === 0 &&
    session.state !== "streaming" &&
    session.state !== "connecting";
  // Live billing can take seconds (quota network). Cache last mark so the
  // welcome logo paints immediately — the SVG itself is inline, not a fetch.
  const [cachedBrandKind, setCachedBrandKind] =
    useState<SuperGrokBrandKind | null>(() => loadCachedSuperGrokBrand());
  /** Active inference channel: custom relay must not show SuperGrok Heavy. */
  const [customRouteActive, setCustomRouteActive] = useState(false);
  const refreshProviderRoute = useCallback(async () => {
    if (!api.isTauri()) {
      setCustomRouteActive(false);
      return;
    }
    try {
      const list = await api.providersList();
      setCustomRouteActive(list.activeSource === "custom");
    } catch {
      /* keep previous */
    }
  }, []);
  useEffect(() => {
    void refreshProviderRoute();
  }, [refreshProviderRoute]);
  const liveBrandKind = useMemo(
    () =>
      superGrokBrandKind(
        account?.billing,
        !!account?.profile?.signedIn,
      ),
    [account?.billing, account?.profile?.signedIn],
  );
  useEffect(() => {
    // Do not cache Heavy while on a custom route — welcome mark is always SuperGrok.
    if (customRouteActive) return;
    if (liveBrandKind) {
      saveCachedSuperGrokBrand(liveBrandKind);
      setCachedBrandKind(liveBrandKind);
      return;
    }
    if (account && !account.profile.signedIn) {
      saveCachedSuperGrokBrand(null);
      setCachedBrandKind(null);
    }
  }, [liveBrandKind, account, customRouteActive]);
  const welcomeBrandKind = useMemo(
    () =>
      resolveWelcomeBrandKind(liveBrandKind, cachedBrandKind, {
        accountReady: account != null,
        signedIn: !!account?.profile?.signedIn,
        customRoute: customRouteActive,
      }),
    [liveBrandKind, cachedBrandKind, account, customRouteActive],
  );

  // Floating composer height → chat bottom pad so messages can scroll under it.
  useEffect(() => {
    if (mainPane !== "chat") return;
    const el = composerWrapRef.current;
    if (!el) return;
    const measure = () => {
      const h = Math.ceil(el.getBoundingClientRect().height);
      if (h <= 0) return;
      // Ignore 1px subpixel flicker — pad thrash reflows chat scrollHeight
      // and looks like the transcript bouncing while you type/scroll.
      setComposerFloatPad((prev) => (Math.abs(prev - h) <= 1 ? prev : h));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [
    mainPane,
    attachments.length,
    draft,
    showComposerPlus,
    messages.length,
    welcomeSession,
    welcomeBrandKind,
  ]);

  const stop = async () => {
    try {
      await api.sessionStop();
      setRetryStatus(null);
      setTurnStartedAt(null);
      setTurnStartedAt(null);
      const liveId = liveHostRef.current.sessionId;
      if (liveId) {
        patchSessionMessages(liveId, (m) =>
          m.map((x) => ({ ...x, streaming: false })),
        );
      } else {
        setMessages((m) => m.map((x) => ({ ...x, streaming: false })));
      }
    } catch (e) {
      setLocalError(String(e));
    }
  };

  /**
   * Bind (or clear) the open session's project. Draft chats only switch
   * workspace context. Untrusted projects refuse bind when a session exists.
   */
  const bindSessionProject = useCallback(
    async (proj: Project | null) => {
      const sid = session.sessionId;
      if (!sid || !api.isTauri()) {
        setActiveProject(proj);
        if (proj) {
          setExpandedProjects((e) => ({ ...e, [proj.id]: true }));
        } else {
          setHistoryOpen(true);
        }
        return;
      }
      if (proj && !proj.trusted) {
        setLocalError(tr("project.trustFirst", { name: proj.name }));
        return;
      }
      try {
        await api.sessionSetProject(sid, proj?.id ?? null);
        setActiveProject(proj);
        setSessions((list) =>
          list.map((s) =>
            s.id === sid ? { ...s, projectId: proj?.id ?? null } : s,
          ),
        );
        // Live agent used old cwd — force reconnect next send
        setSession((prev) =>
          prev.sessionId === sid
            ? {
                ...IDLE_SNAPSHOT,
                sessionId: sid,
                title: prev.title,
                state: "idle",
                backend: prev.backend || "grok_agent_stdio",
              }
            : prev,
        );
        setLiveHost((prev) =>
          prev.sessionId === sid ? { ...IDLE_SNAPSHOT } : prev,
        );
        if (proj) {
          setExpandedProjects((e) => ({ ...e, [proj.id]: true }));
          showToast(tr("composer.projectBound", { name: proj.name }), 2500);
        } else {
          setHistoryOpen(true);
          showToast(tr("composer.projectCleared"), 2200);
        }
        setLocalError(null);
      } catch (e) {
        showToast(String(e), 4500);
      }
    },
    [session.sessionId, showToast, tr],
  );

  /**
   * After a project is created/updated: refresh list, expand, optionally trust
   * via in-app confirm, then set active (+ bind session when requested).
   */
  const finalizeAddedProject = useCallback(
    async (p: Project, opts: { bindSession: boolean }) => {
      const list = (await api.projectsList()) as Project[];
      setProjects(list);
      setSetup((s) => ({ ...s, project: true }));

      const apply = async (proj: Project) => {
        const fresh = (await api.projectsList()) as Project[];
        setProjects(fresh);
        const current = fresh.find((x) => x.id === proj.id) ?? proj;
        if (opts.bindSession) {
          await bindSessionProject(current);
        } else {
          setActiveProject(current);
          setExpandedProjects((e) => ({ ...e, [current.id]: true }));
          showToast(tr("composer.projectAdded", { name: current.name }), 2500);
        }
      };

      // Tauri WebView: never use window.confirm — offer in-app trust dialog.
      if (!p.trusted) {
        setAppDialog({
          kind: "confirm",
          title: tr("project.trustTitle"),
          message: tr("project.trustConfirm", {
            name: p.name,
            path: p.path,
          }),
          confirmLabel: tr("project.trustToSend", { name: p.name }),
          onConfirm: async () => {
            try {
              const trusted = (await api.projectTrust(p.id)) as Project;
              await apply(trusted);
            } catch (e) {
              setLocalError(String(e));
            }
          },
        });
        return;
      }
      await apply(p);
    },
    [bindSessionProject, showToast, tr],
  );

  /**
   * Pick folder → add project (name = folder basename; no rename prompt).
   * `bindSession` also attaches the open chat under the new project.
   */
  const addProjectFromPicker = useCallback(
    async (opts: { bindSession: boolean; autoTrust?: boolean }) => {
      setLocalError(null);
      try {
        if (!api.isTauri()) {
          setLocalError(tr("error.needTauri"));
          return;
        }
        const path = await api.pickDirectory();
        if (!path) return;
        const p = (await api.projectAdd(path, !!opts.autoTrust)) as Project;
        await finalizeAddedProject(p, { bindSession: opts.bindSession });
      } catch (e) {
        setLocalError(String(e));
      }
    },
    [finalizeAddedProject, tr],
  );

  const addProject = async (autoTrust = false) => {
    await addProjectFromPicker({ bindSession: false, autoTrust });
  };

  const trustProject = async (proj?: Project | null) => {
    const target = proj || activeProject;
    if (!target) return;
    try {
      const p = (await api.projectTrust(target.id)) as Project;
      setActiveProject(p);
      setProjects((await api.projectsList()) as Project[]);
      setLocalError(null);
      // CLI connects on first send only.
    } catch (e) {
      setLocalError(String(e));
    }
  };

  const openDoctor = () => {
    setShowDoctor(true);
  };

  // Keep tray menu actions on latest closures (listeners registered once).
  const trayHandlersRef = useRef({
    newChat: () => {},
    openSessionById: (_id: string) => {},
    openSettings: (_section: SettingsSectionId = "general") => {},
    openDoctor: () => {},
  });
  shortcutHandlersRef.current = {
    newChat: () => {
      void newChat();
    },
    openSettings: () => {
      setAppView("settings");
      setSettingsSection("general");
      window.location.hash = "#/settings/general";
    },
  };
  trayHandlersRef.current = {
    newChat: () => {
      void newChat();
    },
    openSessionById: (id: string) => {
      void (async () => {
        let row = sessions.find((s) => s.id === id) ?? null;
        if (!row) {
          try {
            const list = await api.sessionsList();
            const hit = list.find((s) => s.id === id);
            if (hit) {
              row = {
                id: hit.id,
                title: hit.title,
                projectId: hit.projectId,
                updatedAt: hit.updatedAt,
                archived: !!hit.archived,
                scheduled: !!hit.scheduled,
              };
              setSessions(
                list.map((s) => ({
                  id: s.id,
                  title: s.title,
                  projectId: s.projectId,
                  updatedAt: s.updatedAt,
                  archived: !!s.archived,
                  scheduled: !!s.scheduled,
                })),
              );
            }
          } catch {
            /* ignore */
          }
        }
        if (!row) return;
        const proj =
          projects.find((p) => p.id === row!.projectId) ?? null;
        await openSession(row, proj);
      })();
    },
    openSettings: (section: SettingsSectionId = "general") => {
      navigateSettings(section);
    },
    openDoctor: () => {
      void openDoctor();
    },
  };

  // System tray / menu-bar (Codex-style): Recent · More · Usage · New Chat · Open · Quit
  useEffect(() => {
    if (!api.isTauri()) return;
    let cancelled = false;
    const unsubs: Array<() => void> = [];
    void (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        if (cancelled) return;
        unsubs.push(
          await listen("tray://new-chat", () => {
            trayHandlersRef.current.newChat();
          }),
        );
        unsubs.push(
          await listen<{ sessionId?: string }>("tray://open-session", (ev) => {
            const id = ev.payload?.sessionId;
            if (id) trayHandlersRef.current.openSessionById(id);
          }),
        );
        unsubs.push(
          await listen<{ section?: string }>("tray://open-settings", (ev) => {
            const raw = (ev.payload?.section || "general") as SettingsSectionId;
            const allowed: SettingsSectionId[] = [
              "general",
              "appearance",
              "account",
              "archived",
              "extensions",
              "runtime",
              "about",
            ];
            trayHandlersRef.current.openSettings(
              allowed.includes(raw) ? raw : "general",
            );
          }),
        );
        unsubs.push(
          await listen("tray://open-doctor", () => {
            trayHandlersRef.current.openDoctor();
          }),
        );
      } catch (e) {
        console.warn("tray listeners failed", e);
      }
    })();
    return () => {
      cancelled = true;
      for (const u of unsubs) u();
    };
  }, []);

  const error = session.lastError;
  const errorBanner = useMemo(
    () => presentErrorBanner(error, localError, locale),
    [error, localError, locale],
  );
  /** Prefer in-thread turn error; avoid stacking with the top error banner. */
  const hasChatTurnError = useMemo(
    () => messages.some((m) => m.isError),
    [messages],
  );
  // Collapse technical dump whenever the visible error changes.
  useEffect(() => {
    setErrorDetailOpen(false);
  }, [errorBanner?.code, errorBanner?.summary, errorBanner?.detail]);

  const refreshAccount = useCallback(
    async (opts?: { refreshBilling?: boolean }) => {
      if (!api.isTauri()) return;
      setAccountLoading(true);
      try {
        const st = await api.accountStatus({
          refreshBilling: opts?.refreshBilling ?? true,
          manualCliPath: manualCliPath || null,
        });
        setAccount(st);
        setSetup((s) => ({
          ...s,
          auth: isAccountConnected(st),
          cli: st.cliFound || s.cli,
        }));
        try {
          const list = await api.accountsList();
          setSavedAccounts(list.profiles ?? []);
          setActiveAccountId(list.activeId ?? null);
        } catch {
          // multi-account list is best-effort
        }
        // Usage line on tray menu (Codex-style)
        void api.trayRefresh();
      } catch (e) {
        console.warn("account status failed", e);
      } finally {
        setAccountLoading(false);
      }
    },
    [manualCliPath],
  );

  const refreshSavedAccounts = useCallback(async () => {
    if (!api.isTauri()) return;
    try {
      const list = await api.accountsList();
      setSavedAccounts(list.profiles ?? []);
      setActiveAccountId(list.activeId ?? null);
    } catch {
      /* ignore */
    }
  }, []);

  /** Import markdown/JSON transcript as a new local session (from PR #24). */
  const importChatTranscript = useCallback(async () => {
    if (!api.isTauri()) {
      showToast(tr("error.needTauri"));
      return;
    }
    setAccountBusy(true);
    try {
      const created = await api.sessionImportTranscriptFile(
        null,
        activeProject?.id ?? null,
      );
      if (!created) return;
      await refreshSessions();
      showToast(tr("account.importChatOk", { title: created.title }), 3200);
      const list = (await api.sessionsList()) as SessionRow[];
      const hit = list.find((s) => s.id === created.id);
      if (hit) {
        const proj =
          projects.find((p) => p.id === (hit.projectId ?? undefined)) ?? null;
        void openSession(hit, proj ?? undefined);
      }
    } catch (e) {
      showToast(
        `${tr("account.importChatFailed")}: ${String(e)}`,
        5000,
      );
    } finally {
      setAccountBusy(false);
    }
  }, [activeProject?.id, projects, showToast, tr]);

  /** Export active (or given) session as Markdown (from PR #24). */
  const exportActiveSessionMd = useCallback(
    async (sessionMeta?: {
      id: string;
      title: string;
      projectId?: string | null;
    }) => {
      try {
        const id = sessionMeta?.id ?? session.sessionId;
        if (!id) {
          showToast(tr("session.exportFail"));
          return;
        }
        const title =
          sessionMeta?.title ||
          sessions.find((s) => s.id === id)?.title ||
          session.title ||
          tr("session.untitled");
        const projectId =
          sessionMeta?.projectId ??
          sessions.find((s) => s.id === id)?.projectId ??
          null;
        const proj =
          projects.find((p) => p.id === projectId) || activeProject || null;
        let msgs = messages;
        if (id !== session.sessionId) {
          msgs = (await api.sessionMessages(id)) as ChatMessage[];
        }
        const md = sessionToMarkdown({
          title,
          projectName: proj?.name,
          projectPath: proj?.path,
          sessionId: id,
          messages: msgs.map((m) => ({
            role: m.role,
            content: m.content,
            thought: m.thought,
            createdAt: m.createdAt,
          })),
        });
        const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = sessionExportFilename(title, id);
        a.click();
        URL.revokeObjectURL(url);
        showToast(tr("session.exportDone"));
      } catch (e) {
        showToast(`${tr("session.exportFail")}: ${String(e)}`);
      }
    },
    [
      session.sessionId,
      session.title,
      sessions,
      messages,
      projects,
      activeProject,
      showToast,
      tr,
    ],
  );

  const beginEditLastUser = useCallback(
    (msg: ChatMessage) => {
      if (msg.role !== "user") return;
      if (msg.id !== lastUserMessageId) {
        showToast(tr("message.editOnlyLast"));
        return;
      }
      if (!canEditLastUser) {
        showToast(tr("message.editBusy"));
        return;
      }
      // Inline only — do not move content into the main composer.
      // Reload original attachments into editable chips.
      setEditAttachments(
        (msg.attachments ?? []).map((a) => ({
          path: a.path,
          name: a.name,
          isDir: a.isDir,
        })),
      );
      setEditingUserMessageId(msg.id);
    },
    [lastUserMessageId, canEditLastUser, showToast, tr],
  );

  const cancelEditUser = useCallback(() => {
    if (editSubmitting) return;
    setEditingUserMessageId(null);
    setEditAttachments([]);
  }, [editSubmitting]);

  /**
   * Edit last user turn: commit UI immediately (edited bubble + thinking),
   * then connect / rewind / send while the thinking row is already visible.
   */
  const submitEditLastUser = useCallback(
    async (msg: ChatMessage, storedDisplay: string) => {
      if (msg.role !== "user" || msg.id !== lastUserMessageId) {
        showToast(tr("message.editOnlyLast"));
        return;
      }
      if (!canEditLastUser || editSubmitting) {
        showToast(tr("message.editBusy"));
        return;
      }
      const segments = parseStoredContent(storedDisplay);
      // Live editable set is the source of truth (may have added/removed files).
      const att: Attachment[] = editAttachments.map((a) => ({
        path: a.path,
        name: a.name,
        isDir: a.isDir,
      }));
      if (isDraftEmpty(segments) && !att.length) return;

      const agentBody = serializeForAgent(segments, { goalMode });
      const agentText = buildAgentPrompt(agentBody, att);
      const titleSeed =
        serializeForAgent(segments).replace(/\n/g, " ").trim() ||
        att.map((a) => a.name).join(", ");
      const shouldAutoTitle =
        isPlaceholderTitle(session.title) || !session.sessionId;
      const pendingAssistantId = `a-pending-${Date.now()}`;
      // May still be a draft id; ensureConnected materializes it later.
      let sendTargetId = session.sessionId;
      let cacheKey = sendTargetId ?? "__draft__";
      const nowIso = new Date().toISOString();

      setEditSubmitting(true);

      // 1) Instant UI commit — same as normal send: user bubble + thinking.
      //    Connect/rewind wait happens under this thinking row, not the edit form.
      setMessages((m) => {
        const kept = truncateBeforeLastUser(m);
        const next: ChatMessage[] = [
          ...kept,
          {
            id: `u-${Date.now()}`,
            role: "user",
            content: storedDisplay,
            attachments: att.length ? att : undefined,
            createdAt: nowIso,
          },
          {
            id: pendingAssistantId,
            role: "assistant",
            content: "",
            streaming: true,
          },
        ];
        messagesBySessionRef.current.set(cacheKey, next);
        return next;
      });
      setEditingUserMessageId(null);
      setEditAttachments([]);
      setRetryStatus(null);
      setSession((prev) =>
        prev.state === "streaming" || prev.state === "awaiting_permission"
          ? prev
          : { ...prev, state: "streaming", lastError: null },
      );
      setLiveHost((prev) => {
        if (sendTargetId && prev.sessionId && prev.sessionId !== sendTargetId) {
          return prev;
        }
        const next = {
          ...prev,
          sessionId: sendTargetId ?? prev.sessionId,
          state: "streaming" as const,
          lastError: null,
        };
        liveHostRef.current = next;
        return next;
      });

      const failPending = (errText?: string) => {
        const errTarget = sendTargetId ?? viewingSessionIdRef.current;
        patchSessionMessages(errTarget, (m) =>
          applyTurnError(
            m,
            {
              messageId: pendingAssistantId,
              content: errText || tr("message.editConnectFailed"),
            },
            localeRef.current,
          ),
        );
        if (
          viewingSessionIdRef.current === sendTargetId ||
          viewingSessionIdRef.current === errTarget ||
          (!sendTargetId && viewingSessionIdRef.current === null)
        ) {
          setSession((prev) =>
            prev.state === "streaming"
              ? { ...prev, state: prev.sessionId ? "ready" : prev.state }
              : prev,
          );
        }
      };

      // 2) Background: connect → rewind journal → send (thinking already shown).
      try {
        const sessionId = await ensureConnected();
        if (!sessionId) {
          failPending(tr("message.editConnectFailed"));
          return;
        }
        // Draft / id migrate after materialize.
        if (sessionId !== cacheKey) {
          const prevCache = messagesBySessionRef.current.get(cacheKey);
          if (prevCache?.length) {
            messagesBySessionRef.current.set(sessionId, prevCache);
            messagesBySessionRef.current.delete(cacheKey);
          }
          sendTargetId = sessionId;
          cacheKey = sessionId;
        }

        if (api.isTauri()) {
          try {
            await api.sessionRewindDropLastUser();
          } catch (e) {
            console.warn("session rewind before edit failed", e);
            // Continue: UI already replaced the turn; resend still proceeds.
          }
        }

        await api.sessionSend(agentText, storedDisplay);
        if (shouldAutoTitle && api.isTauri()) {
          void api
            .sessionAutoTitle(sessionId, titleSeed)
            .then((meta) => {
              if (meta?.title) applySessionTitle(sessionId, meta.title);
            })
            .catch(() => {
              /* ignore */
            });
        }
      } catch (e) {
        failPending(String(e));
        if (
          viewingSessionIdRef.current === sendTargetId ||
          viewingSessionIdRef.current === null
        ) {
          setLocalError(String(e));
        }
      } finally {
        setEditSubmitting(false);
      }
    },
    [
      lastUserMessageId,
      canEditLastUser,
      editSubmitting,
      editAttachments,
      showToast,
      tr,
      goalMode,
      session.title,
      session.sessionId,
      // ensureConnected / patchSessionMessages / applySessionTitle via closure
    ],
  );

  const runAccountLogin = useCallback(
    async (method: "oauth" | "device" = "oauth"): Promise<boolean> => {
      if (!api.isTauri()) {
        showToast(tr("error.needTauri"));
        return false;
      }
      setAccountBusy(true);
      setLoginHint(null);
      try {
        const res = await api.accountLogin(method);
        if (res.ok) {
          setLoginHint(null);
          showToast(tr("account.loginOk"), 2800);
        } else {
          const msg = res.message || tr("account.loginFailed");
          setLoginHint(msg);
          showToast(msg, 6000);
        }
        if (res.deviceUrl) {
          try {
            await api.openExternalUrl(res.deviceUrl);
          } catch {
            /* host may already open it */
          }
          showToast(
            [res.deviceUrl, res.deviceCode ? `code: ${res.deviceCode}` : ""]
              .filter(Boolean)
              .join(" · "),
            10000,
          );
        }
        await refreshAccount({ refreshBilling: true });
        await refreshSavedAccounts();
        // Drop live agent so next send re-spawns with synced auth.json in agent-home.
        if (res.ok && api.isTauri()) {
          try {
            await api.sessionDisconnect();
            setSession({ ...IDLE_SNAPSHOT });
          } catch {
            /* ignore */
          }
        }
        return !!res.ok;
      } catch (e) {
        const msg = String(e);
        setLoginHint(msg);
        showToast(msg, 4500);
        return false;
      } finally {
        setAccountBusy(false);
      }
    },
    [refreshAccount, refreshSavedAccounts, showToast, tr],
  );

  /** Abort a running login (OAuth/device) so the user can pick another method
   *  without restarting the app. The backend kills the `grok login` child. */
  const cancelAccountLogin = useCallback(async () => {
    try {
      await api.accountLoginCancel();
    } catch {
      /* ignore — still unlock UI */
    }
    setAccountBusy(false);
  }, []);

  const runSaveAccount = useCallback(async () => {
    if (!api.isTauri()) return;
    setAccountBusy(true);
    try {
      await api.accountSaveCurrent();
      await refreshSavedAccounts();
      showToast(tr("account.profileSaved"), 2500);
    } catch (e) {
      showToast(String(e), 4500);
    } finally {
      setAccountBusy(false);
    }
  }, [refreshSavedAccounts, showToast, tr]);

  /**
   * Save current login (if any), then start OAuth so the user can add another
   * account without losing the previous snapshot.
   */
  const runAddAccount = useCallback(async () => {
    if (!api.isTauri()) {
      showToast(tr("error.needTauri"));
      return;
    }
    // Snapshot current auth first so switcher keeps it.
    if (account?.profile?.signedIn) {
      setAccountBusy(true);
      try {
        await api.accountSaveCurrent();
        await refreshSavedAccounts();
        showToast(tr("account.profileSaved"), 1800);
      } catch (e) {
        // Still try login — user may want a fresh account even if save fails.
        showToast(String(e), 3500);
      } finally {
        setAccountBusy(false);
      }
    }
    await runAccountLogin("oauth");
  }, [
    account?.profile?.signedIn,
    refreshSavedAccounts,
    runAccountLogin,
    showToast,
    tr,
  ]);

  const runSwitchAccount = useCallback(
    async (id: string) => {
      if (!api.isTauri()) return;
      setAccountBusy(true);
      try {
        await api.accountSwitch(id);
        await refreshAccount({ refreshBilling: true });
        await refreshSavedAccounts();
        try {
          await api.sessionDisconnect();
        } catch {
          /* ignore */
        }
        setSession({ ...IDLE_SNAPSHOT });
        showToast(tr("account.profileSwitched"), 2500);
      } catch (e) {
        showToast(String(e), 4500);
      } finally {
        setAccountBusy(false);
      }
    },
    [refreshAccount, refreshSavedAccounts, showToast, tr],
  );

  const runRemoveAccount = useCallback(
    (id: string) => {
      if (!api.isTauri()) return;
      const label =
        savedAccounts.find((a) => a.id === id)?.label || id.slice(0, 8);
      setAppDialog({
        kind: "confirm",
        title: tr("account.profileRemove"),
        message: tr("account.profilesHint"),
        confirmLabel: tr("account.profileRemove"),
        danger: true,
        onConfirm: async () => {
          setAccountBusy(true);
          try {
            await api.accountRemove(id);
            await refreshSavedAccounts();
            showToast(tr("account.profileRemoved"), 2200);
          } catch (e) {
            showToast(String(e), 4500);
          } finally {
            setAccountBusy(false);
          }
        },
      });
      void label;
    },
    [refreshSavedAccounts, savedAccounts, showToast, tr],
  );

  const runAccountLogout = useCallback(async () => {
    if (!api.isTauri()) return;
    setAccountBusy(true);
    try {
      await api.accountLogout();
      await refreshAccount({ refreshBilling: false });
      await refreshSavedAccounts();
      try {
        await api.sessionDisconnect();
        setSession({ ...IDLE_SNAPSHOT });
      } catch {
        /* ignore */
      }
    } catch (e) {
      showToast(String(e), 4500);
    } finally {
      setAccountBusy(false);
    }
  }, [refreshAccount, refreshSavedAccounts, showToast]);

  // Account boot: paint fast from disk cache first, then refresh quota on network.
  // Welcome SuperGrok logo depends on billing tier — waiting only on the slow
  // path made the mark look like a "slow image" even though it is inline SVG.
  useEffect(() => {
    if (!api.isTauri()) return;
    let cancelled = false;
    void (async () => {
      await refreshAccount({ refreshBilling: false });
      if (cancelled) return;
      await refreshAccount({ refreshBilling: true });
      if (cancelled) return;
      await refreshSavedAccounts();
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshAccount, refreshSavedAccounts]);

  useEffect(() => {
    if (appView === "settings" && settingsSection === "account") {
      void refreshAccount({ refreshBilling: true });
      void refreshSavedAccounts();
    }
  }, [appView, settingsSection, refreshAccount, refreshSavedAccounts]);

  const settingsLabels = useMemo(() => {
    const keys = [
      "settings.backToApp",
      "settings.searchPlaceholder",
      "settings.group.personal",
      "settings.group.system",
      "settings.nav.general",
      "settings.nav.appearance",
      "settings.nav.account",
      "settings.nav.archived",
      "settings.nav.extensions",
      "settings.nav.runtime",
      "settings.nav.about",
      "settings.archived.desc",
      "settings.archived.empty",
      "settings.archived.restore",
      "settings.archived.delete",
      "settings.archived.orphan",
      "settings.archived.selectAll",
      "settings.archived.deselectAll",
      "settings.archived.selectedCount",
      "settings.archived.totalCount",
      "session.untitled",
      "settings.section.permissions",
      "settings.section.composer",
      "settings.section.general",
      "settings.language",
      "settings.languageDesc",
      "settings.sessionDataMode",
      "settings.sessionDataModeDesc",
      "settings.cliPath",
      "settings.cliPathDesc",
      "settings.cliNotFound",
      "settings.permissionDeep",
      "settings.permissionDeepDesc",
      "settings.prefsScope",
      "settings.prefsScopeDesc",
      "settings.prefsScope.global",
      "settings.prefsScope.project",
      "settings.prefsScope.session",
      "settings.availableModels",
      "settings.availableModelsDesc",
      "settings.availableModelsEmpty",
      "settings.theme",
      "settings.themeDesc",
      "settings.themeLight",
      "settings.themeDark",
      "settings.doctorDesc",
      "settings.runDoctor",
      "settings.aboutApp",
      "composer.permissionTitle",
      "policy.ask",
      "policy.accept_edits",
      "policy.allow_for_session",
      "policy.dont_ask",
      "policy.always_approve",
      "settings.modeIndependent",
      "settings.modeShared",
      "settings.tabOfficial",
      "settings.tabProviders",
      "settings.tabOfficialHint",
      "settings.tabProvidersHint",
      "settings.openTarget",
      "settings.openTargetDesc",
      "settings.openFinder",
      "settings.sharedConfirm",
      "doctor.title",
      "doctor.close",
      "doctor.rerun",
      "doctor.copy",
      "doctor.copied",
      "doctor.loading",
      "doctor.error",
      "doctor.empty",
      "doctor.summary",
      "doctor.generatedAt",
      "doctor.level.ok",
      "doctor.level.warn",
      "doctor.level.fail",
      "doctor.check.cli",
      "doctor.check.auth",
      "doctor.check.workspace",
      "doctor.check.backend",
      "doctor.check.logs",
      "common.local",
      "common.close",
      "common.cancel",
      "account.section.profile",
      "account.section.runtime",
      "account.signedIn",
      "account.signedOut",
      "account.loginOauth",
      "account.loginDevice",
      "account.loginBusy",
      "account.loginCancel",
      "account.logout",
      "account.refresh",
      "account.refreshing",
      "account.manageUsage",
      "account.subscribe",
      "account.channel",
      "account.channel.oauth",
      "account.channel.key",
      "account.channel.relay",
      "account.channel.none",
      "account.subscription",
      "account.weeklyTitle",
      "account.quota",
      "account.quotaRemaining",
      "account.quotaUsed",
      "account.quotaUnknown",
      "account.period",
      "account.prepaid",
      "account.onDemand",
      "account.resetsAt",
      "account.fetchedAt",
      "account.products",
      "account.heatmap",
      "account.heatmapHint",
      "account.heatmap.less",
      "account.heatmap.more",
      "account.heatmap.noData",
      "account.heatmap.aria",
      "account.heatmap.requests",
      "account.heatmap.tokens",
      "account.callLogs",
      "account.callLogsEmpty",
      "account.col.session",
      "account.col.model",
      "account.col.turns",
      "account.col.tokens",
      "account.col.duration",
      "account.col.when",
      "account.expired",
      "account.team",
      "account.billingUnavailable",
      "account.cliAuthOk",
      "account.cliAuthMissing",
      "account.loginHelpTitle",
      "account.loginHelpBody",
      "account.loginTryDevice",
      "account.profiles",
      "account.profilesHint",
      "account.profilesEmpty",
      "account.profileSave",
      "account.profileSwitch",
      "account.profileRemove",
      "account.profileActive",
      "account.manageAccounts",
      "account.addAccount",
      "account.profileSwitch",
      "account.profileRemove",
      "account.profileActive",
      "account.importChat",
      "account.importChatHint",
      "account.importChatBtn",
    ] as const;
    const out: Record<string, string> = {};
    for (const k of keys) out[k] = tr(k);
    return out;
  }, [tr]);

  return (
    <ImageViewerProvider locale={locale}>
    <div
      className={
        `app-shell platform-${platform}` +
        (windowMaximized ? " is-maximized" : "") +
        (useCustomWindowChrome ? " has-custom-chrome" : "")
      }
      data-testid="app-shell"
    >
      <WindowControls
        visible={useCustomWindowChrome}
        labels={{
          minimize: tr("window.minimize"),
          maximize: tr("window.maximize"),
          restore: tr("window.restore"),
          close: tr("window.close"),
        }}
      />

      {appGate === "loading" && (
        <div className="setup-gate" data-testid="setup-booting">
          <div className="setup-gate__drag" data-tauri-drag-region />
          <div className="setup-gate__center">
            <div className="setup-hero">
              <div className="setup-logo setup-logo--spin">
                <GrokLogo size={44} />
              </div>
              <h1 className="setup-title">{tr("setup.title")}</h1>
              <p className="setup-subtitle">{tr("setup.detecting")}</p>
            </div>
          </div>
        </div>
      )}

      {appGate === "setup" && (
        <SetupWizard
          tr={tr}
          platform={platform}
          useCustomWindowChrome={useCustomWindowChrome}
          initialCli={
            setupCliSeed ?? {
              found: false,
              path: null,
              version: null,
              source: "",
              cliAuthPresent: false,
            }
          }
          onAccountLoginOauth={() => runAccountLogin("oauth")}
          onComplete={(cli) => {
            setCliInfo({
              found: cli.found,
              path: cli.path,
              version: cli.version,
              source: cli.source,
              cliAuthPresent: cli.cliAuthPresent,
            });
            if (cli.path) setManualCliPath(cli.path);
            setSetup((s) => ({
              ...s,
              cli: cli.found,
              auth: s.auth || cli.cliAuthPresent,
            }));
            setAppGate("ready");
            void refreshLists();
            void refreshAccount({ refreshBilling: false });
          }}
        />
      )}

      {appGate === "ready" && (appView === "settings" ? (
        <SettingsPage
          section={settingsSection}
          onSection={(id) => {
            setSettingsSection(id);
            window.location.hash = `#/settings/${id}`;
          }}
          onBack={navigateWorkbench}
          labels={settingsLabels}
          locale={locale}
          onLocale={(v) => {
            const next = resolveLocale(v);
            setLocale(next);
            void api.settingsGet().then(async (s) => {
              await api.settingsSet({ ...s, locale: next });
              // settings_set also refreshes tray; call again so UI stays in sync if invoke fails mid-way.
              void api.trayRefresh();
            });
          }}
          theme={theme}
          onTheme={applyThemeChoice}
          sessionDataMode={sessionDataMode}
          onSessionDataMode={(v) => {
            const commit = () => {
              setSessionDataMode(v);
              void api.settingsGet().then((s) =>
                api.settingsSet({ ...s, sessionDataMode: v }),
              );
            };
            // Tauri WebView: window.confirm is unreliable (often always false).
            if (v === "shared") {
              setAppDialog({
                kind: "confirm",
                title: tr("settings.sessionDataMode"),
                message: tr("settings.sharedConfirm"),
                confirmLabel: tr("common.confirm"),
                onConfirm: commit,
              });
              return;
            }
            commit();
          }}
          policy={policy}
          onPolicy={(v) => {
            if (!isValidPolicy(v)) return;
            applyPermissionPolicy(v);
          }}
          prefsScope={prefsScope}
          onPrefsScope={(v) => {
            if (!isValidPrefsScope(v)) return;
            setPrefsScope(v);
            void api.settingsGet().then((s) =>
              api.settingsSet({ ...s, composerPrefsScope: v }),
            );
            void api
              .composerPrefsResolve({
                projectId: activeProject?.id ?? null,
                sessionId: session.sessionId ?? null,
              })
              .then((prefs) => applyComposerPrefs(prefs, availableModels))
              .catch(() => {});
          }}
          availableModels={availableModels}
          manualCliPath={manualCliPath}
          onManualCliPath={setManualCliPath}
          onCliBlur={(v) => {
            void api.settingsGet().then((s) =>
              api.settingsSet({ ...s, manualCliPath: v || null }),
            );
            void api.probeCli(v || undefined).then((cli) => {
              setCliInfo({
                found: cli.found,
                path: cli.path,
                version: cli.version,
                source: cli.source || "",
                cliAuthPresent: !!cli.cliAuthPresent,
              });
              setSetup((prev) => ({
                ...prev,
                cli: cli.found,
                auth: prev.auth || !!cli.cliAuthPresent,
              }));
            });
          }}
          acpServerAddr={acpServerAddr}
          onAcpServerAddr={(v) => {
            setAcpServerAddr(v);
            void api.settingsGet().then((s) =>
              api.settingsSet({ ...s, acpServerAddr: v.trim() || null }),
            );
          }}
          maxConcurrentAgents={maxConcurrentAgents}
          onMaxConcurrentAgents={(v) => {
            setMaxConcurrentAgents(v);
            void api.settingsGet().then((s) =>
              api.settingsSet({ ...s, maxConcurrentAgents: v }),
            );
          }}
          agentIdleMinutes={agentIdleMinutes}
          onAgentIdleMinutes={(v) => {
            setAgentIdleMinutes(v);
            void api.settingsGet().then((s) =>
              api.settingsSet({ ...s, agentIdleMinutes: v }),
            );
          }}
          cliInfo={cliInfo}
          onDoctor={() => void openDoctor()}
          versionFooter={tr("app.versionFooter")}
          account={account}
          accountLoading={accountLoading}
          accountBusy={accountBusy}
          loginHint={loginHint}
          savedAccounts={savedAccounts}
          activeAccountId={activeAccountId}
          onAccountLoginOauth={() => void runAccountLogin("oauth")}
          onAccountLoginDevice={() => void runAccountLogin("device")}
          onCancelLogin={() => void cancelAccountLogin()}
          onAccountLogout={() => void runAccountLogout()}
          onAccountRefresh={() => void refreshAccount({ refreshBilling: true })}
          onAccountManageUsage={() => void api.accountOpenUsage()}
          onAccountSubscribe={() => void api.accountOpenSubscribe()}
          onSaveAccount={() => void runSaveAccount()}
          onAddAccount={() => void runAddAccount()}
          onSwitchAccount={(id) => void runSwitchAccount(id)}
          onRemoveAccount={(id) => void runRemoveAccount(id)}
          onImportChat={() => void importChatTranscript()}
          defaultOpenTarget={defaultOpenTarget}
          onDefaultOpenTarget={(v) => {
            setDefaultOpenTarget(v);
            void api.settingsGet().then((s) =>
              api.settingsSet({ ...s, defaultOpenTarget: v }),
            );
          }}
          archivedGroups={archivedGroups}
          onRestoreArchivedSessions={(ids) => {
            const rows = ids
              .map((id) => sessions.find((x) => x.id === id))
              .filter((s): s is SessionRow => !!s);
            void restoreSessions(rows);
          }}
          onDeleteArchivedSessions={(ids) => {
            const rows = ids
              .map((id) => sessions.find((x) => x.id === id))
              .filter((s): s is SessionRow => !!s);
            deleteSessionsConfirm(rows);
          }}
          projectPath={activeProject?.path ?? null}
          onProviderActivated={() => {
            // Hot-reload Grok Build: drop live ACP so next send re-spawns with new GROK_HOME config.
            void (async () => {
              try {
                if (api.isTauri()) {
                  await api.sessionDisconnect();
                  setSession({ ...IDLE_SNAPSHOT });
                }
                await refreshProviderRoute();
                setToast(tr("prov.switchedHotReload"));
                window.setTimeout(() => setToast(null), 3200);
              } catch (e) {
                setToast(String(e));
              }
            })();
          }}
        />
      ) : (
      <div className="workbench">
        {/* LEFT — fully hideable (not icon-rail); open via top-bar icon when closed */}
        <aside
          className={
            "sidebar" +
            (layout.sidebarCollapsed ? " sidebar--hidden" : "") +
            (dragZone === "sidebar" ? " is-drop-target" : "") +
            (dragZone === "main" ? " is-drop-idle" : "")
          }
          aria-hidden={layout.sidebarCollapsed}
        >
          {dragZone === "sidebar" && (
            <div className="drop-overlay drop-overlay--project" aria-hidden>
              <div className="drop-overlay__card">
                <span className="drop-overlay__icon">
                  <IconFolderPlus size={22} />
                </span>
                <strong>{tr("composer.dropProjectTitle")}</strong>
                <span>{tr("composer.dropProjectHint")}</span>
              </div>
            </div>
          )}
          {/* Row 1: traffic-light height — panel toggle sits just right of traffic lights */}
          <div
            className="sidebar-chrome"
            data-tauri-drag-region
            onDoubleClick={() => {
              if (useCustomWindowChrome) void toggleMaximizeFromTitlebar();
            }}
          >
            <Tip label={tr("main.leftPaneHide")}>
              <button
                type="button"
                className="chrome-btn chrome-btn--traffic main__pane-toggle is-on"
                onClick={() =>
                  setLayout((l) => {
                    const n = { ...l, sidebarCollapsed: true };
                    saveLayout(localStorage, n);
                    return n;
                  })
                }
              >
                <IconPanel size={16} />
              </button>
            </Tip>
            <div className="sidebar-chrome__drag" data-tauri-drag-region />
          </div>

          {/* Row 2: brand + search (Codex: title left, search right) */}
          <div className="sidebar-brand-row">
            <div className="sidebar-brand-row__left">
              <GrokLogo size={20} />
              <span>Grok</span>
            </div>
            <Tip label={tr("sidebar.search")}>
              <button
                type="button"
                className="chrome-btn"
                onClick={() => {
                  setShowSearch(true);
                  setSearchQuery("");
                }}
              >
                <IconSearch size={16} />
              </button>
            </Tip>
          </div>

          {/* Primary nav — new orphan session + scheduled tasks (Codex parity) */}
          <div className="sidebar-nav">
            <button
              type="button"
              className="nav-new"
              onClick={() => void newChat(null)}
            >
              <span className="nav-item__icon">
                <IconNewChat size={16} />
              </span>
              {tr("sidebar.newSession")}
            </button>
            <button
              type="button"
              className={
                "nav-item" +
                (mainPane === "automations" ? " nav-item--active" : "")
              }
              onClick={() => navigateAutomations()}
            >
              <span className="nav-item__icon">
                <IconScheduled size={16} />
              </span>
              {tr("sidebar.scheduled")}
            </button>
          </div>

          <OverlayScroll className="sidebar__scroll" viewportClassName="sidebar__scroll-inner">
            {/* L1 — Projects section */}
            <div className="tree-l1">
              <button
                type="button"
                className="tree-l1__head"
                onClick={() => setProjectsOpen((v) => !v)}
              >
                {projectsOpen ? (
                  <IconChevronDown size={14} />
                ) : (
                  <IconChevronRight size={14} />
                )}
                <span className="tree-l1__label">
                  {tr("sidebar.projects")}
                </span>
              </button>
              <Tip label={tr("sidebar.addProject")}>
                <button
                  type="button"
                  className="tree-l1__action"
                  onClick={() => void addProject(false)}
                >
                  <IconPlus size={15} />
                </button>
              </Tip>
            </div>

            {projectsOpen && projects.length === 0 && (
              <div className="sidebar-empty">
                {tr("sidebar.noProjects")}
              </div>
            )}

            {projectsOpen &&
              projects.map((proj) => {
                const open = expandedProjects[proj.id] !== false;
                const projSessions = sessionsForProject(proj.id);
                return (
                  <div key={proj.id} className="tree-project">
                    {/* L2 — project folder: expand/collapse only (not selectable) */}
                    <div
                      className="tree-l2"
                      role="button"
                      tabIndex={0}
                      aria-expanded={open}
                      onClick={() => {
                        setExpandedProjects((e) => ({
                          ...e,
                          [proj.id]: !open,
                        }));
                      }}
                      onContextMenu={(e) => openProjectMenu(e, proj)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setExpandedProjects((ex) => ({
                            ...ex,
                            [proj.id]: !open,
                          }));
                        }
                      }}
                    >
                      <span className="tree-l2__icon">
                        <IconFolder size={15} />
                      </span>
                      <Tip label={proj.path}>
                        <span className="tree-l2__name">
                          {proj.pinned ? (
                            <IconPin size={12} className="tree-l2__pin" />
                          ) : null}
                          {proj.name}
                        </span>
                      </Tip>
                      {!proj.trusted && (
                        <span className="project-row__badge">
                          {tr("sidebar.untrusted")}
                        </span>
                      )}
                      <span className="tree-l2__actions">
                        <Tip label={tr("sidebar.newConversation")}>
                          <button
                            type="button"
                            className="tree-icon-btn"
                            disabled={!proj.trusted}
                            onClick={(e) => {
                              e.stopPropagation();
                              void newChat(proj);
                            }}
                          >
                            <IconSquarePen size={14} />
                          </button>
                        </Tip>
                        <Tip label={tr("sidebar.menu")}>
                          <button
                            type="button"
                            className="tree-icon-btn"
                            onClick={(e) => openProjectMenu(e, proj)}
                          >
                            <IconMore size={14} />
                          </button>
                        </Tip>
                      </span>
                    </div>

                    {open && (
                      <div className="tree-l3-list">
                        {!proj.trusted && (
                          <button
                            type="button"
                            className="tree-l3 tree-l3--hint"
                            onClick={(e) => {
                              e.stopPropagation();
                              void trustProject(proj);
                            }}
                          >
                            {tr("sidebar.trustProject")}
                          </button>
                        )}
                        {projSessions.map((s) => {
                          const working = busySessionId === s.id;
                          return (
                          <div
                            key={s.id}
                            className={
                              "tree-l3" +
                              (session.sessionId === s.id
                                ? " tree-l3--active"
                                : "") +
                              (s.archived ? " tree-l3--archived" : "") +
                              (working ? " tree-l3--working" : "")
                            }
                            role="button"
                            tabIndex={0}
                            onClick={() => void openSession(s, proj)}
                            onContextMenu={(e) => openSessionMenu(e, s)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") void openSession(s, proj);
                            }}
                          >
                            <span className="tree-l3__title">
                              {s.scheduled ? (
                                <span
                                  className="tree-l3__kind"
                                  title={tr("automations.msgTag")}
                                  aria-label={tr("automations.msgTag")}
                                >
                                  <IconClock size={13} />
                                </span>
                              ) : null}
                              <span className="tree-l3__name">
                                {s.title || "Untitled"}
                              </span>
                            </span>
                            {working ? (
                              <Tip label={tr("sidebar.sessionWorking")}>
                                <span
                                  className="tree-l3__status"
                                  aria-label={tr("sidebar.sessionWorking")}
                                >
                                  <Spinner
                                    size={14}
                                    className="tree-l3__spinner"
                                  />
                                </span>
                              </Tip>
                            ) : (
                            <span className="tree-l3__actions">
                              <Tip
                                label={
                                  s.archived
                                    ? tr("sidebar.unarchive")
                                    : tr("sidebar.archive")
                                }
                              >
                                <button
                                  type="button"
                                  className="tree-icon-btn"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void archiveSession(s, !s.archived);
                                  }}
                                >
                                  <IconArchive size={13} />
                                </button>
                              </Tip>
                              <Tip label={tr("sidebar.menu")}>
                                <button
                                  type="button"
                                  className="tree-icon-btn"
                                  onClick={(e) => openSessionMenu(e, s)}
                                >
                                  <IconMore size={13} />
                                </button>
                              </Tip>
                            </span>
                            )}
                          </div>
                          );
                        })}
                        {projSessions.length === 0 && proj.trusted && (
                          <div className="sidebar-empty" style={{ padding: "4px 10px" }}>
                            {tr("sidebar.noChats")}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

            {/* Orphans / history */}
            <div className="tree-l1" style={{ marginTop: 8 }}>
              <button
                type="button"
                className="tree-l1__head"
                onClick={() => setHistoryOpen((v) => !v)}
              >
                {historyOpen ? (
                  <IconChevronDown size={14} />
                ) : (
                  <IconChevronRight size={14} />
                )}
                <span className="tree-l1__label">
                  {tr("sidebar.otherSessions")}
                </span>
              </button>
            </div>
            {historyOpen &&
              orphanSessions.map((s) => {
                const working = busySessionId === s.id;
                return (
                <div
                  key={s.id}
                  className={
                    "tree-l3 tree-l3--orphan" +
                    (session.sessionId === s.id ? " tree-l3--active" : "") +
                    (working ? " tree-l3--working" : "")
                  }
                  role="button"
                  tabIndex={0}
                  onClick={() => void openSession(s)}
                  onContextMenu={(e) => openSessionMenu(e, s)}
                >
                  <span className="tree-l3__title">
                    {s.scheduled ? (
                      <span
                        className="tree-l3__kind"
                        title={tr("automations.msgTag")}
                        aria-label={tr("automations.msgTag")}
                      >
                        <IconClock size={13} />
                      </span>
                    ) : null}
                    <span className="tree-l3__name">
                      {s.title || "Untitled"}
                    </span>
                  </span>
                  {working ? (
                    <Tip label={tr("sidebar.sessionWorking")}>
                      <span
                        className="tree-l3__status"
                        aria-label={tr("sidebar.sessionWorking")}
                      >
                        <Spinner size={14} className="tree-l3__spinner" />
                      </span>
                    </Tip>
                  ) : (
                  <span className="tree-l3__actions">
                    <Tip label={tr("sidebar.archive")}>
                      <button
                        type="button"
                        className="tree-icon-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          void archiveSession(s, !s.archived);
                        }}
                      >
                        <IconArchive size={13} />
                      </button>
                    </Tip>
                    <button
                      type="button"
                      className="tree-icon-btn"
                      onClick={(e) => openSessionMenu(e, s)}
                    >
                      <IconMore size={13} />
                    </button>
                  </span>
                  )}
                </div>
                );
              })}
          </OverlayScroll>

          <UserMenu
            open={showUserMenu}
            onClose={() => setShowUserMenu(false)}
            theme={theme}
            account={account}
            accountBusy={accountBusy}
            labels={{
              settings: tr("sidebar.settings"),
              theme: tr("user.theme"),
              themeLight: tr("user.themeLight"),
              themeDark: tr("user.themeDark"),
              local: tr("common.local"),
              signedIn: tr("account.signedIn"),
              signedOut: tr("account.signedOut"),
              login: tr("account.login"),
              logout: tr("account.logout"),
              remaining: tr("account.quotaRemaining"),
              resetsAt: tr("account.resetsAt"),
            }}
            onSettings={() => navigateSettings("general")}
            onAccountSettings={() => navigateSettings("account")}
            onToggleTheme={toggleThemeBtn}
            onLogin={() => void runAccountLogin("oauth")}
            onLogout={() => void runAccountLogout()}
          >
            <Tip label={tr("user.menu")}>
            <button
              type="button"
              className={
                "sidebar__footer" + (showUserMenu ? " is-open" : "")
              }
              aria-haspopup="menu"
              aria-expanded={showUserMenu}
              onClick={() => {
                setShowUserMenu((v) => !v);
                if (!showUserMenu) void refreshAccount({ refreshBilling: true });
              }}
            >
              <div className="user-avatar" aria-hidden>
                {account?.profile
                  ? accountInitials(account.profile)
                  : "G"}
              </div>
              <div className="user-meta">
                <span className="user-meta__name">
                  {account?.profile
                    ? accountDisplayName(account.profile, tr("common.local"))
                    : tr("common.local")}
                </span>
                {(() => {
                  // Only show SuperGrok remaining when officially signed in.
                  if (!account?.profile?.signedIn) return null;
                  const rem = remainingPercent(account);
                  return rem != null ? (
                    <span className="user-meta__quota">{rem.toFixed(0)}%</span>
                  ) : null;
                })()}
              </div>
            </button>
            </Tip>
          </UserMenu>
        </aside>

        {/* CENTER — solid pane; top icons fully toggle L/R columns */}
        <main
          className={
            "main" +
            (layout.sidebarCollapsed ? " main--sidebar-hidden" : "") +
            (dragZone === "main" ? " is-drop-target" : "") +
            (dragZone === "sidebar" ? " is-drop-idle" : "")
          }
        >
          {dragZone === "main" && (
            <div className="drop-overlay drop-overlay--attach" aria-hidden>
              <div className="drop-overlay__card">
                <span className="drop-overlay__icon">
                  <IconAttach size={22} />
                </span>
                <strong>{tr("composer.dropAttachTitle")}</strong>
                <span>{tr("composer.dropAttachHint")}</span>
              </div>
            </div>
          )}
          {toast && (
            <div className="app-toast" role="status">
              {toast}
            </div>
          )}
          <div
            className="main__top"
            data-tauri-drag-region
            onDoubleClick={() => {
              if (useCustomWindowChrome) void toggleMaximizeFromTitlebar();
            }}
          >
            <div className="main__title-row" data-tauri-drag-region>
              {/* When left rail is hidden, reopen control sits next to traffic lights */}
              {layout.sidebarCollapsed && (
                <Tip label={tr("main.leftPaneShow")}>
                  <button
                    type="button"
                    className="chrome-btn chrome-btn--traffic main__pane-toggle"
                    onClick={() =>
                      setLayout((l) => {
                        const n = { ...l, sidebarCollapsed: false };
                        saveLayout(localStorage, n);
                        return n;
                      })
                    }
                  >
                    <IconPanel size={16} />
                  </button>
                </Tip>
              )}
              {mainPane === "automations" ? (
                <>
                  <span className="main__title-icon">
                    <IconScheduled size={16} />
                  </span>
                  <h1 className="main__title" data-tauri-drag-region>
                    {tr("automations.title")}
                  </h1>
                </>
              ) : (
                (() => {
                  const cur = sessions.find((s) => s.id === session.sessionId);
                  const title =
                    cur?.title ||
                    session.title ||
                    activeProject?.name ||
                    tr("session.new");
                  const isScheduledSession =
                    !!cur?.scheduled ||
                    messages.some(
                      (m) =>
                        m.role === "user" &&
                        !!parseScheduledUserContent(m.content || ""),
                    );
                  return (
                    <>
                      {isScheduledSession ? (
                        <span
                          className="main__title-icon"
                          title={tr("automations.msgTag")}
                          aria-label={tr("automations.msgTag")}
                        >
                          <IconClock size={16} />
                        </span>
                      ) : null}
                      <Tip label={title}>
                        <h1 className="main__title" data-tauri-drag-region>
                          {title}
                        </h1>
                      </Tip>
                      {cur && (
                        <Tip label={tr("session.menu")}>
                          <button
                            type="button"
                            className="chrome-btn main__title-menu"
                            onClick={(e) => openSessionMenu(e, cur)}
                          >
                            <IconMore size={16} />
                          </button>
                        </Tip>
                      )}
                    </>
                  );
                })()
              )}
            </div>
            <div className="main__top-actions">
              {mainPane === "chat" && (
                <span
                  className={`status-pill status-pill--${connPill.tone}`}
                  role="status"
                  title={tr(connPill.labelKey as MessageKey)}
                >
                  <span className="status-pill__dot" aria-hidden />
                  {tr(connPill.labelKey as MessageKey)}
                </span>
              )}
              {/* Retry progress only — connection is silent; thinking lives in chat */}
              {retryStatus && (
                <Tip
                  label={retryStatus.reason || ""}
                  disabled={!retryStatus.reason}
                >
                  <span className="main__sub main__sub--retry">
                    {retryStatus.reason
                      ? tr("main.retryingWithReason", {
                          attempt: String(retryStatus.attempt),
                          max: String(retryStatus.maxRetries),
                          reason:
                            retryStatus.reason.length > 72
                              ? `${retryStatus.reason.slice(0, 72)}…`
                              : retryStatus.reason,
                        })
                      : tr("main.retrying", {
                          attempt: String(retryStatus.attempt),
                          max: String(retryStatus.maxRetries),
                        })}
                  </span>
                </Tip>
              )}
              {activeProject && mainPane === "chat" && (
                <OpenLocationButton
                  path={activeProject.path}
                  target={defaultOpenTarget || "finder"}
                  onTargetChange={persistOpenTarget}
                  onOpenError={(e) => setLocalError(e)}
                  onCopied={() => {
                    setToast(tr("attach.copyPath") + " ✓");
                    window.setTimeout(() => setToast(null), 1600);
                  }}
                  platform={platform === "win" ? "win" : platform === "mac" ? "mac" : "other"}
                  labels={{
                    openLocation: tr("main.openLocation"),
                    openHint: tr("main.openLocationHint"),
                    openMenu: tr("main.openLocationMenu"),
                    finder:
                      platform === "win"
                        ? tr("main.openInExplorer")
                        : tr("main.openInFinder"),
                    systemDefault: tr("main.openSystemDefault"),
                    copyPath: tr("attach.copyPath"),
                  }}
                />
              )}
              <Tip
                label={
                  layout.asideCollapsed
                    ? tr("main.rightPaneShow")
                    : tr("main.rightPaneHide")
                }
              >
                <button
                  type="button"
                  className={
                    "chrome-btn main__pane-toggle" +
                    (!layout.asideCollapsed ? " is-on" : "")
                  }
                  onClick={() =>
                    setLayout((l) => {
                      const n = { ...l, asideCollapsed: !l.asideCollapsed };
                      saveLayout(localStorage, n);
                      return n;
                    })
                  }
                >
                  <IconPanelRight size={16} />
                </button>
              </Tip>
            </div>
          </div>

          {mainPane === "automations" ? (
            <AutomationsPage
              t={(k, vars) =>
                tr(k as Parameters<typeof tr>[0], vars as Record<string, string | number>)
              }
              projects={projects.map((p) => ({ id: p.id, name: p.name }))}
              defaultModelId={modelId}
              defaultEffort={effort}
              models={availableModels}
              onAiCreate={() => {
                void newChat(null, {
                  seedDraft: aiCreateSeedPrompt("Grok"),
                  switchToChat: true,
                  automationSetup: true,
                });
                setToast(tr("automations.aiComposerHint"));
                window.setTimeout(() => setToast(null), 4200);
              }}
              onRunNow={(auto) => void runAutomation(auto)}
            />
          ) : (
          <>
          {activeProject && !activeProject.trusted && (
            <div className="conn-bar">
              <button
                type="button"
                className="btn btn--primary"
                style={{ height: 24, fontSize: 11 }}
                onClick={() => void trustProject(activeProject)}
              >
                {tr("project.trustToSend", { name: activeProject.name })}
              </button>
            </div>
          )}

          {emptyExistingSession && (
            <div className="conn-bar" role="status">
              <span style={{ fontSize: 12, opacity: 0.85 }}>
                {tr("automations.emptySession")}
              </span>
            </div>
          )}

          {/* One surface only: turn failures live in chat; banner is for pre-turn/local errors */}
          {errorBanner && !hasChatTurnError && (
            <div className="error-banner" role="alert">
              <div className="error-banner__summary">{errorBanner.summary}</div>
              {(errorBanner.detail ||
                errorBanner.reconnectHint ||
                session.state === "disconnected") && (
                <div className="error-banner__actions">
                  {errorBanner.detail && (
                    <button
                      type="button"
                      className="error-banner__details-btn"
                      aria-expanded={errorDetailOpen}
                      onClick={() => setErrorDetailOpen((v) => !v)}
                    >
                      {errorDetailOpen
                        ? tr("error.hideDetails")
                        : tr("error.details")}
                    </button>
                  )}
                  {(errorBanner.reconnectHint ||
                    session.state === "disconnected") && (
                    <button
                      type="button"
                      className="btn btn--ghost error-banner__reconnect"
                      disabled={connecting}
                      onClick={() => {
                        setLocalError(null);
                        setErrorDetailOpen(false);
                        void ensureConnected(true).then((sid) => {
                          if (sid) setLocalError(null);
                        });
                      }}
                    >
                      {tr("main.reconnect")}
                    </button>
                  )}
                </div>
              )}
              {errorBanner.detail && errorDetailOpen && (
                <pre className="error-banner__detail">{errorBanner.detail}</pre>
              )}
            </div>
          )}

          <div
            className="main__stage"
            style={
              {
                ["--composer-float-pad"]: `${composerFloatPad}px`,
              } as CSSProperties
            }
          >
          <ConversationThread
            locale={locale}
            messages={messages}
            sessionState={session.state}
            sessionKey={session.sessionId ?? `draft-${session.title ?? "new"}`}
            projectPath={activeProject?.path ?? null}
            suppressEmptyCopy={welcomeSession}
            canEditLastUser={canEditLastUser}
            lastUserMessageId={lastUserMessageId}
            editingUserMessageId={editingUserMessageId}
            editSubmitting={editSubmitting}
            editAttachments={editAttachments}
            onEditUserMessage={beginEditLastUser}
            onCancelEditUserMessage={cancelEditUser}
            onSubmitEditUserMessage={(msg, content) => {
              void submitEditLastUser(msg, content);
            }}
            onRemoveEditAttachment={(att) =>
              setEditAttachments((prev) =>
                prev.filter((x) => x.path !== att.path),
              )
            }
            canRewindSession={canRewindSession && !!session.sessionId}
            onRewindToUserMessage={onRewindToUserMessage}
            onForkFromUserMessage={onForkFromUserMessage}
            turnStartedAt={turnStartedAt}
            onOpenResource={(target) => {
              setLayout((l) => {
                if (l.asideCollapsed) {
                  const n = { ...l, asideCollapsed: false };
                  saveLayout(localStorage, n);
                  return n;
                }
                return l;
              });
              setResourceOpenTarget(target);
            }}
            plan={plan}
            onApprovePlan={() => {
              void (async () => {
                try {
                  await api.sessionResolvePlan({
                    decision: "approved",
                    rpcId: plan.rpcId,
                  });
                  setPlan((p) => ({
                    ...p,
                    visible: false,
                    waiting: false,
                    rpcId: null,
                  }));
                  showToast(tr("plan.approvedToast"), 2500);
                } catch (e) {
                  showToast(String(e), 4500);
                }
              })();
            }}
            onRequestPlanChanges={() => {
              void (async () => {
                try {
                  await api.sessionResolvePlan({
                    decision: "cancelled",
                    feedback: tr("plan.reviseFeedback"),
                    rpcId: plan.rpcId,
                  });
                  setPlan((p) => ({
                    ...p,
                    visible: false,
                    waiting: false,
                    rpcId: null,
                  }));
                  showToast(tr("plan.reviseToast"), 2800);
                } catch (e) {
                  showToast(String(e), 4500);
                }
              })();
            }}
            onDismissPlan={() => {
              void (async () => {
                if (plan.rpcId != null) {
                  try {
                    await api.sessionResolvePlan({
                      decision: "abandoned",
                      rpcId: plan.rpcId,
                    });
                  } catch {
                    /* still hide UI */
                  }
                }
                setPlan((p) => ({
                  ...p,
                  visible: false,
                  waiting: true,
                  entries: [],
                  body: "",
                  rpcId: null,
                }));
              })();
            }}
            onAddAttachmentToComposer={(att) =>
              setAttachments((prev) => mergeAttachments(prev, [att]))
            }
            attachLabels={attachLabels}
          />

          <div
            ref={composerWrapRef}
            className={
              "composer-wrap composer-wrap--float" +
              (welcomeSession ? " composer-wrap--welcome" : "")
            }
          >
            {welcomeSession && welcomeBrandKind ? (
              <div className="composer-welcome-mark">
                <SuperGrokMark
                  kind={welcomeBrandKind}
                  title={
                    customRouteActive
                      ? "SuperGrok"
                      : account?.billing?.subscriptionTier?.trim() ||
                        (welcomeBrandKind === "heavy"
                          ? "SuperGrok Heavy"
                          : "SuperGrok")
                  }
                />
              </div>
            ) : null}
            {perm ? (
              <div
                className="perm-bar"
                role="dialog"
                aria-label={tr("perm.title")}
              >
                <div className="perm-bar__head">
                  <span className="perm-bar__badge">{tr("perm.title")}</span>
                  <span className="perm-bar__tool">
                    {perm.title || perm.toolName}
                  </span>
                </div>
                <p className="perm-bar__summary">
                  {formatPermissionSummary({
                    toolName: perm.toolName,
                    title: perm.title,
                    command: perm.preview,
                  })}
                </p>
                {perm.preview?.trim() ? (
                  <pre className="perm-bar__preview">{perm.preview.trim()}</pre>
                ) : null}
                <div className="perm-bar__actions">
                  {mapPermissionButtons(perm.options, {
                    allowOnce: tr("perm.allowOnce"),
                    allowSession: tr("perm.allowSession"),
                    deny: tr("perm.deny"),
                  }).map((btn) => (
                    <button
                      key={btn.decision + btn.optionId}
                      type="button"
                      className={
                        "perm-bar__btn" +
                        (btn.decision === "allow_once"
                          ? " perm-bar__btn--allow"
                          : btn.decision === "deny"
                            ? " perm-bar__btn--deny"
                            : " perm-bar__btn--session")
                      }
                      title={
                        btn.decision === "allow_once"
                          ? tr("perm.hintOnce")
                          : btn.decision === "allow_session"
                            ? tr("perm.hintSession")
                            : tr("perm.hintDeny")
                      }
                      onClick={() =>
                        void api
                          .sessionResolvePermission({
                            rpcId: perm.rpcId,
                            decision: btn.decision,
                            optionId: btn.optionId,
                            scopeKey: perm.scopeKey,
                          })
                          .then(() => setPerm(null))
                      }
                    >
                      {btn.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <div
              ref={composerShellRef}
              className={
                "composer" +
                (dragZone === "main" ? " composer--drop-ready" : "")
              }
            >
              {attachments.length > 0 && (
                <div
                  className="composer__attachments"
                  aria-label={tr("composer.attachCount", {
                    n: String(attachments.length),
                  })}
                >
                  {attachments.map((a) => (
                    <AttachmentCard
                      key={a.path}
                      attachment={a}
                      variant="chip"
                      labels={attachLabels}
                      galleryPaths={attachments
                        .filter((x) => !x.isDir && isImagePath(x.path))
                        .map((x) => x.path)}
                      onRemove={(att) =>
                        setAttachments((prev) =>
                          prev.filter((x) => x.path !== att.path),
                        )
                      }
                      onAddToComposer={(att) =>
                        setAttachments((prev) => mergeAttachments(prev, [att]))
                      }
                    />
                  ))}
                </div>
              )}
              {composerMenuOpen &&
                composerPlusPos &&
                typeof document !== "undefined" &&
                createPortal(
                  <ComposerPlusPanel
                    open
                    panelRef={composerPlusPanelRef}
                    locale={locale}
                    entries={composerMenuEntries}
                    filterQuery={
                      liveSlash.present ? slashFilterQuery : undefined
                    }
                    skillsLoading={skillsLoading}
                    activeIndex={slashActiveIndex}
                    onActiveIndexChange={setSlashActiveIndex}
                    onSelectUpload={() => {
                      void pickComposerFiles();
                    }}
                    onSelectSlash={applySlashItem}
                    resolveTitle={resolveSlashTitle}
                    resolveDescription={resolveSlashDescription}
                    style={{
                      ...composerPlusStyle,
                      zIndex: 10050,
                    }}
                  />,
                  document.body,
                )}
              <ComposerEditor
                editorRef={composerInputRef}
                className="composer__input"
                value={draft}
                disabled={!canType(session.state)}
                placeholder={
                  goalMode
                    ? tr("composer.goalPlaceholder")
                    : tr("composer.placeholder")
                }
                onChange={setDraft}
                onPasteFiles={(files) => {
                  void addAttachmentsFromFiles(files);
                }}
                onSlashQueryChange={onSlashQueryChange}
                onKeyDown={(e) => {
                  if (
                    e.nativeEvent.isComposing ||
                    (e.nativeEvent as KeyboardEvent).keyCode === 229
                  ) {
                    return;
                  }
                  if (composerMenuOpen) {
                    // Ref = same array the panel renders (never desync).
                    const flat = composerMenuEntriesRef.current;
                    const n = flat.length;
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      if (!n) return;
                      setSlashActiveIndex((i) => (i + 1) % n);
                      return;
                    }
                    if (e.key === "ArrowUp") {
                      e.preventDefault();
                      if (!n) return;
                      setSlashActiveIndex((i) => (i - 1 + n) % n);
                      return;
                    }
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      const entry =
                        flat[
                          Math.min(
                            Math.max(0, slashActiveIndex),
                            Math.max(0, n - 1),
                          )
                        ];
                      if (!entry) return;
                      if (entry.kind === "upload") void pickComposerFiles();
                      else applySlashItem(entry.item);
                      return;
                    }
                    if (e.key === "Escape") {
                      e.preventDefault();
                      closeComposerMenu();
                      return;
                    }
                    if (e.key === "Tab" && n > 0) {
                      e.preventDefault();
                      const entry =
                        flat[
                          Math.min(
                            Math.max(0, slashActiveIndex),
                            n - 1,
                          )
                        ]!;
                      if (entry.kind === "upload") void pickComposerFiles();
                      else applySlashItem(entry.item);
                      return;
                    }
                  }
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (
                      canSend(session.state) &&
                      (!isDraftEmpty(parseStoredContent(draft)) ||
                        attachments.length > 0) &&
                      !connecting
                    ) {
                      void send();
                    }
                  }
                  if (e.key === "Escape") closeComposerMenu();
                }}
              />
              <div className="composer__row">
                <Tip label={tr("composer.add")}>
                  <button
                    ref={composerPlusTriggerRef}
                    type="button"
                    className={
                      "icon-btn icon-btn--plus" +
                      (composerMenuOpen ? " is-open" : "")
                    }
                    onClick={() => {
                      if (composerMenuOpen) {
                        closeComposerMenu();
                      } else {
                        setShowComposerPlus(true);
                      }
                    }}
                  >
                    <IconPlus size={18} />
                  </button>
                </Tip>
                <ComposerProjectMenu
                  activeProject={activeProject}
                  projects={projects}
                  labels={{
                    noProject: tr("composer.noProject"),
                    pickProject: tr("composer.pickProject"),
                    addProject: tr("composer.addProject"),
                  }}
                  disabled={
                    session.state === "streaming" ||
                    session.state === "awaiting_permission"
                  }
                  onSelect={(proj) => {
                    void bindSessionProject(proj);
                  }}
                  onAdd={() => {
                    void addProjectFromPicker({ bindSession: true });
                  }}
                />
                {goalMode ? (
                  <Tip label={tr("composer.goalHint")}>
                    <button
                      type="button"
                      className="chip chip--goal"
                      onClick={() => setGoalMode(false)}
                      aria-label={tr("composer.goalClear")}
                    >
                      <IconImagine size={14} />
                      <span className="chip__label">{tr("composer.goal")}</span>
                      <IconClose size={12} />
                    </button>
                  </Tip>
                ) : null}
                <ComposerModelMenu
                  modelId={modelId}
                  effort={effort}
                  models={availableModels}
                  labels={{
                    model: tr("composer.model"),
                    effort: tr("composer.effort"),
                    effortHigh: tr("effort.high"),
                    effortMedium: tr("effort.medium"),
                    effortLow: tr("effort.low"),
                  }}
                  onModel={(v) => {
                    if (!isValidModelId(v, availableModels)) return;
                    setModelId(v);
                    void api
                      .composerPrefsSet({
                        projectId: activeProject?.id ?? null,
                        sessionId: session.sessionId ?? null,
                        modelId: v,
                      })
                      .catch((e) => showToast(String(e), 4000));
                  }}
                  onEffort={(v) => {
                    if (!isValidEffort(v)) return;
                    setEffort(v);
                    void api
                      .composerPrefsSet({
                        projectId: activeProject?.id ?? null,
                        sessionId: session.sessionId ?? null,
                        effort: v,
                      })
                      .catch((e) => showToast(String(e), 4000));
                  }}
                />
                <ComposerAccessMenu
                  mode={mode}
                  policy={policy}
                  labels={{
                    access: tr("composer.access"),
                    accessHint: tr("composer.accessHint"),
                    mode: tr("composer.mode"),
                    modeAgent: tr("mode.agent"),
                    modePlan: tr("mode.plan"),
                    modeAsk: tr("mode.ask"),
                    modeAgentDesc: tr("mode.agentDesc"),
                    modePlanDesc: tr("mode.planDesc"),
                    modeAskDesc: tr("mode.askDesc"),
                    permission: tr("composer.permission"),
                    policyAsk: tr("policy.ask"),
                    policyAcceptEdits: tr("policy.accept_edits"),
                    policySession: tr("policy.allow_for_session"),
                    policyDontAsk: tr("policy.dont_ask"),
                    policyYolo: tr("policy.always_approve"),
                    policyAskDesc: tr("policy.askDesc"),
                    policyAcceptEditsDesc: tr("policy.accept_editsDesc"),
                    policySessionDesc: tr("policy.allow_for_sessionDesc"),
                    policyDontAskDesc: tr("policy.dont_askDesc"),
                    policyYoloDesc: tr("policy.always_approveDesc"),
                    policyShortAsk: tr("policy.short.ask"),
                    policyShortAccept: tr("policy.short.accept_edits"),
                    policyShortSession: tr("policy.short.allow_for_session"),
                    policyShortDontAsk: tr("policy.short.dont_ask"),
                    policyShortYolo: tr("policy.short.always_approve"),
                  }}
                  onMode={(v) => {
                    setMode(v);
                    if (v === "plan") setGoalMode(false);
                    void api
                      .composerPrefsSet({
                        projectId: activeProject?.id ?? null,
                        sessionId: session.sessionId ?? null,
                        mode: v,
                      })
                      .catch((e) => showToast(String(e), 4000));
                  }}
                  onPolicy={(v: PermissionPolicyId) => {
                    applyPermissionPolicy(v);
                  }}
                />
                <ContextUsageChip
                  display={contextUsageDisplay}
                  labels={{
                    aria: tr("context.chipAria"),
                    tipUnknown: tr("context.chipTipUnknown"),
                    tipEstimated: tr("context.chipTipEstimated"),
                    tipKnown: tr("context.chipTipKnown"),
                    menuTitle: tr("context.menuTitle"),
                    current: tr("context.current"),
                    sourceKnown: tr("context.sourceKnown"),
                    sourceEstimated: tr("context.sourceEstimated"),
                    sourceUnknown: tr("context.sourceUnknown"),
                    lastCompact: tr("context.lastCompact"),
                    lastCompactNone: tr("context.lastCompactNone"),
                    tokensRange: tr("compact.tokensRange"),
                    compactAction: tr("context.compactAction"),
                    heuristicNote: tr("context.heuristicNote"),
                    auto: tr("context.triggerAuto"),
                    manual: tr("context.triggerManual"),
                  }}
                  onCompact={() => {
                    setCompactNote("");
                    setShowCompactModal(true);
                  }}
                />
                <span className="composer__spacer" />
                {canStop(session.state) ? (
                  <Tip label={tr("composer.stop")}>
                    <button
                      type="button"
                      className="icon-btn icon-btn--danger"
                      onClick={() => void stop()}
                      aria-label={tr("composer.stop")}
                    >
                      <IconStop size={14} />
                    </button>
                  </Tip>
                ) : (
                  <Tip label={tr("composer.send")}>
                    <button
                      type="button"
                      className="icon-btn icon-btn--primary"
                      disabled={
                        !canSend(session.state) ||
                        (isDraftEmpty(parseStoredContent(draft)) &&
                          attachments.length === 0) ||
                        connecting
                      }
                      onClick={() => void send()}
                      aria-label={tr("composer.send")}
                    >
                      <IconSend size={16} />
                    </button>
                  </Tip>
                )}
              </div>
            </div>
          </div>
          </div>
          </>
          )}
        </main>

        {/* RIGHT — session-linked project resource viewer (fully hideable + resizable) */}
        <aside
          className={
            (layout.asideCollapsed ? "aside aside--hidden" : "aside") +
            (resizingAside ? " is-resizing" : "")
          }
          aria-hidden={layout.asideCollapsed}
          style={
            !layout.asideCollapsed
              ? {
                  width: layout.asideWidth,
                  minWidth: layout.asideWidth,
                  maxWidth: layout.asideWidth,
                }
              : undefined
          }
        >
          {!layout.asideCollapsed && (
            <div
              className="aside-resizer"
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize files pane"
              onPointerDown={(e) => {
                e.preventDefault();
                setResizingAside(true);
              }}
            />
          )}
          <div className="aside__inner">
            <ResourceViewer
              projectPath={activeProject?.path ?? null}
              projectName={activeProject?.name ?? null}
              locale={locale}
              paneActive={!layout.asideCollapsed}
              openRequest={resourceOpenTarget}
              onOpenRequestConsumed={() => setResourceOpenTarget(null)}
              sessionChanges={
                sessionChangesById[session.sessionId || ""] ?? []
              }
              onClose={() =>
                setLayout((l) => {
                  const n = { ...l, asideCollapsed: true };
                  saveLayout(localStorage, n);
                  return n;
                })
              }
            />
          </div>
        </aside>
      </div>
      ))}

      <DoctorModal
        open={showDoctor}
        onClose={() => setShowDoctor(false)}
        locale={locale}
        onConfirm={({ title, message, confirmLabel, danger, onConfirm }) => {
          setAppDialog({
            kind: "confirm",
            title,
            message,
            confirmLabel,
            danger,
            onConfirm,
          });
        }}
        onResetDone={() => {
          void refreshLists();
        }}
      />
      <GlassModal
        open={showShortcuts}
        onClose={() => setShowShortcuts(false)}
        title={tr("shortcuts.title")}
        size="md"
        closeLabel={tr("shortcuts.close")}
        footer={
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => setShowShortcuts(false)}
          >
            {tr("shortcuts.close")}
          </button>
        }
      >
        <ul className="shortcuts-list">
          {shortcutsForPlatform(
            platform === "mac" ? "mac" : platform === "win" ? "win" : "other",
          ).map((row) => (
            <li key={row.id} className="shortcuts-list__row">
              <span className="shortcuts-list__label">
                {tr(row.labelKey as MessageKey)}
              </span>
              <kbd className="shortcuts-list__keys">{row.keys}</kbd>
            </li>
          ))}
        </ul>
      </GlassModal>
      <AskUserModal
        payload={askUser}
        labels={{
          title: tr("askUser.title"),
          submit: tr("askUser.submit"),
          cancel: tr("askUser.cancel"),
          otherPlaceholder: tr("askUser.otherPlaceholder"),
          freeTextHint: tr("askUser.freeTextHint"),
          multiHint: tr("askUser.multiHint"),
          close: tr("common.close"),
        }}
        onSubmit={async (answers) => {
          if (!askUser) return;
          try {
            await api.sessionResolveAskUser({
              decision: "accepted",
              answers,
              rpcId: askUser.rpcId,
            });
            setAskUser(null);
          } catch (e) {
            showToast(String(e), 4500);
          }
        }}
        onCancel={async () => {
          if (!askUser) return;
          try {
            await api.sessionResolveAskUser({
              decision: "cancelled",
              rpcId: askUser.rpcId,
            });
          } catch {
            /* still hide UI */
          }
          setAskUser(null);
        }}
      />
      <StatusModal
        open={showStatusModal}
        locale={locale}
        sessionId={session.sessionId}
        agentSessionId={session.agentSessionId}
        modelId={modelId}
        effort={effort}
        mode={mode}
        policy={policy}
        projectPath={activeProject?.path}
        messageCount={messages.length}
        onClose={() => setShowStatusModal(false)}
      />
      <McpStatusModal
        open={showMcpModal}
        locale={locale}
        servers={mcpServers}
        error={mcpError}
        loading={mcpLoading}
        onClose={() => setShowMcpModal(false)}
        onManage={() => navigateSettings("extensions")}
      />
      {rewindTimeline && (
        <div
          className="overlay"
          role="presentation"
          onClick={() => {
            if (!rewindBusy) setRewindTimeline(null);
          }}
        >
          <div
            className="modal rewind-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="rewind-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="modal-head">
              <h2 id="rewind-modal-title" className="modal-title">
                {tr("session.rewindTitle")}
              </h2>
              <button
                type="button"
                className="icon-btn modal-close"
                onClick={() => setRewindTimeline(null)}
                aria-label={tr("common.close")}
                disabled={rewindBusy}
              >
                <IconClose size={16} />
              </button>
            </header>
            <p className="rewind-modal__msg">{tr("session.rewindHint")}</p>
            <div className="rewind-modal__list" role="list">
              {rewindTimeline.points.map((p) => {
                const isLast =
                  p.promptIndex ===
                  rewindTimeline.points[rewindTimeline.points.length - 1]
                    ?.promptIndex;
                return (
                  <button
                    key={`${p.promptIndex}-${p.messageId ?? ""}`}
                    type="button"
                    role="listitem"
                    className="rewind-modal__item"
                    disabled={rewindBusy || isLast}
                    title={
                      isLast
                        ? tr("session.rewindNoop")
                        : tr("message.rewindHere")
                    }
                    onClick={() => {
                      if (isLast) {
                        showToast(tr("session.rewindNoop"));
                        return;
                      }
                      confirmRewindToPrompt(
                        rewindTimeline.sessionId,
                        p.promptIndex,
                        p.preview,
                      );
                    }}
                  >
                    <span className="rewind-modal__idx">
                      #{p.promptIndex + 1}
                    </span>
                    <span className="rewind-modal__preview">
                      {p.preview || "…"}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn--ghost"
                disabled={rewindBusy}
                onClick={() => setRewindTimeline(null)}
              >
                {tr("common.cancel")}
              </button>
            </div>
          </div>
        </div>
      )}

      {showCompactModal && (
        <div
          className="overlay"
          role="presentation"
          onClick={() => {
            setShowCompactModal(false);
            setCompactNote("");
          }}
        >
          <form
            className="modal compact-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="compact-modal-title"
            onSubmit={(e) => {
              e.preventDefault();
              const note = compactNote;
              setShowCompactModal(false);
              setCompactNote("");
              void (async () => {
                const cmd = note.trim()
                  ? `/compact ${note.trim()}`
                  : "/compact";
                try {
                  const sid = await ensureConnected();
                  if (!sid) return;
                  await api.sessionSend(cmd);
                } catch (err) {
                  setLocalError(String(err));
                }
              })();
            }}
          >
            <header className="modal-head">
              <h2 id="compact-modal-title" className="modal-title">
                {tr("slash.compact")}
              </h2>
              <button
                type="button"
                className="icon-btn modal-close"
                onClick={() => {
                  setShowCompactModal(false);
                  setCompactNote("");
                }}
                aria-label={tr("common.close")}
              >
                <IconClose size={16} />
              </button>
            </header>
            <p className="compact-modal__msg">
              {tr("slash.compactConfirm")}
            </p>
            <input
              ref={compactNoteRef}
              className="compact-modal__field"
              value={compactNote}
              onChange={(e) => setCompactNote(e.target.value)}
              placeholder={tr("slash.compactNote")}
              autoFocus
              autoComplete="off"
            />
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => {
                  setShowCompactModal(false);
                  setCompactNote("");
                }}
              >
                {tr("slash.compactConfirmCancel")}
              </button>
              <button type="submit" className="btn btn--solid">
                {tr("slash.compactConfirmOk")}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Search / command palette (Codex-style) */}
      {showSearch && (
        <div
          className="overlay"
          onClick={() => setShowSearch(false)}
        >
          <div
            className="search-panel"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label={tr("sidebar.search")}
          >
            <div className="search-panel__head">
              <IconSearch size={16} />
              <input
                autoFocus
                className="search-panel__input"
                placeholder={
                  tr("search.placeholder")
                }
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <button
                type="button"
                className="icon-btn modal-close"
                onClick={() => setShowSearch(false)}
                aria-label={tr("common.close")}
              >
                <IconClose size={16} />
              </button>
            </div>
            {searchHits.matchedProjects.length > 0 && (
              <>
                <div className="search-panel__section">
                  {tr("sidebar.projects")}
                </div>
                {searchHits.matchedProjects.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="search-panel__row"
                    onClick={() => {
                      setShowSearch(false);
                      // Project is a folder: expand only; selection is for sessions.
                      setProjectsOpen(true);
                      setExpandedProjects((e) => ({ ...e, [p.id]: true }));
                    }}
                  >
                    <IconFolder size={15} />
                    <span className="search-panel__title">{p.name}</span>
                    <span className="search-panel__meta">{p.path}</span>
                  </button>
                ))}
              </>
            )}
            <div className="search-panel__section">
              {tr("search.chats")}
            </div>
            {searchHits.matchedSessions.length === 0 && (
              <div className="sidebar-empty" style={{ padding: 12 }}>
                {tr("search.noMatches")}
              </div>
            )}
            {searchHits.matchedSessions.map((hit, i) => {
              const s = sessions.find((x) => x.id === hit.id);
              if (!s) return null;
              const proj = projects.find((p) => p.id === s.projectId);
              return (
                <button
                  key={s.id}
                  type="button"
                  className="search-panel__row"
                  onClick={() => {
                    setShowSearch(false);
                    void openSession(s, proj ?? null);
                  }}
                >
                  <IconSquarePen size={15} />
                  <span className="search-panel__title">
                    {s.title || "Untitled"}
                  </span>
                  <span className="search-panel__meta">
                    {proj?.name ?? "—"}
                    {i < 9 ? `  ⌘${i + 1}` : ""}
                  </span>
                </button>
              );
            })}
            <div className="search-panel__foot">
              <button
                type="button"
                className="search-panel__row"
                onClick={() => {
                  setShowSearch(false);
                  void newChat(activeProject);
                }}
              >
                <IconSquarePen size={15} />
                <span className="search-panel__title">
                  {tr("search.newChat")}
                </span>
              </button>
              <button
                type="button"
                className="search-panel__row"
                onClick={() => {
                  setShowSearch(false);
                  void addProject(false);
                }}
              >
                <IconFolder size={15} />
                <span className="search-panel__title">
                  {tr("sidebar.addProject")}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* In-app confirm / prompt (Tauri WebView has no reliable window.prompt/confirm) */}
      {appDialog &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="overlay app-dialog-overlay"
            role="presentation"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) setAppDialog(null);
            }}
          >
            <div
              className="modal app-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="app-dialog-title"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <header className="modal-head">
                <h2 id="app-dialog-title" className="modal-title">
                  {appDialog.title}
                </h2>
                <button
                  type="button"
                  className="icon-btn modal-close"
                  onClick={() => setAppDialog(null)}
                  aria-label={tr("common.close")}
                >
                  <IconClose size={16} />
                </button>
              </header>
              {appDialog.kind === "confirm" ? (
                <form
                  className="app-dialog__form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    // Prefer the keyboard path's latest ref so chained
                    // dialogs (YOLO step1 → step2) stay consistent.
                    const dialog = appDialogRef.current;
                    if (!dialog || dialog.kind !== "confirm") return;
                    const run = dialog.onConfirm;
                    setAppDialog(null);
                    void run();
                  }}
                >
                  <p className="app-dialog__msg">{appDialog.message}</p>
                  <div className="app-dialog__actions modal-actions">
                    <button
                      type="button"
                      className="btn btn--ghost"
                      onClick={() => setAppDialog(null)}
                    >
                      {tr("common.cancel")}
                    </button>
                    <button
                      ref={confirmBtnRef}
                      type="submit"
                      className={`btn ${appDialog.danger ? "btn--danger" : "btn--solid"}`}
                    >
                      {appDialog.confirmLabel || tr("common.confirm")}
                    </button>
                  </div>
                </form>
              ) : (
                <form
                  className="app-dialog__form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const value = dialogInput;
                    const submit = appDialog.onSubmit;
                    setAppDialog(null);
                    void submit(value);
                  }}
                >
                  <input
                    ref={dialogInputRef}
                    className="app-dialog__input"
                    value={dialogInput}
                    placeholder={appDialog.placeholder}
                    onChange={(e) => setDialogInput(e.target.value)}
                    autoComplete="off"
                  />
                  <div className="app-dialog__actions modal-actions">
                    <button
                      type="button"
                      className="btn btn--ghost"
                      onClick={() => setAppDialog(null)}
                    >
                      {tr("common.cancel")}
                    </button>
                    <button type="submit" className="btn btn--solid">
                      {tr("common.save")}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>,
          document.body,
        )}

      {/* Floating context menu (project / session) — unified ContextMenu */}
      {(() => {
        let items: ContextMenuItem[] = [];
        if (ctxMenu?.kind === "project") {
          const proj = projects.find((p) => p.id === ctxMenu.id);
          if (proj) {
            items = [
              {
                id: "pin",
                label: proj.pinned
                  ? tr("project.unpin")
                  : tr("project.pin"),
                icon: proj.pinned ? (
                  <IconPinOff size={16} />
                ) : (
                  <IconPin size={16} />
                ),
                onClick: () => {
                  void api
                    .projectSetPinned(proj.id, !proj.pinned)
                    .then(() => refreshProjects());
                },
              },
              {
                id: "reveal",
                label: tr("project.reveal"),
                icon: <IconExternalLink size={16} />,
                onClick: () => {
                  void api
                    .projectReveal(proj.id)
                    .catch((e) => setLocalError(String(e)));
                },
              },
              {
                id: "rename",
                label: tr("project.rename"),
                icon: <IconRename size={16} />,
                onClick: () => renameProject(proj),
              },
              {
                id: "archive-chats",
                label: tr("project.archiveChats"),
                icon: <IconArchive size={16} />,
                onClick: () => {
                  void archiveProjectSessions(proj);
                },
              },
              {
                id: "remove",
                label: tr("project.remove"),
                icon: <IconTrash size={16} />,
                danger: true,
                onClick: () => removeProjectFromApp(proj),
              },
            ];
          }
        } else if (ctxMenu?.kind === "session") {
          const s = sessions.find((x) => x.id === ctxMenu.id);
          if (s) {
            const isOpen =
              session.sessionId === s.id ||
              viewingSessionIdRef.current === s.id;
            items = [
              {
                id: "rename",
                label: tr("session.rename"),
                icon: <IconRename size={16} />,
                onClick: () => renameSession(s),
              },
              {
                id: "export-md",
                label: tr("session.exportMd"),
                icon: <IconCopy size={16} />,
                onClick: () => {
                  void exportActiveSessionMd({
                    id: s.id,
                    title: s.title,
                    projectId: s.projectId,
                  });
                },
              },
              {
                id: "fork",
                label: tr("session.fork"),
                icon: <IconFork size={16} />,
                onClick: () => confirmForkSession(s),
              },
              {
                id: "rewind",
                label: tr("session.rewind"),
                icon: <IconRewind size={16} />,
                disabled: !isOpen || !canRewindSession,
                onClick: () => {
                  void openRewindTimeline(s.id);
                },
              },
              {
                id: "copy-id",
                label: tr("session.copyId"),
                icon: <IconCopy size={16} />,
                onClick: () => {
                  void copySessionId(s);
                },
              },
              {
                id: "archive",
                label: s.archived
                  ? tr("sidebar.unarchive")
                  : tr("sidebar.archive"),
                icon: <IconArchive size={16} />,
                onClick: () => {
                  void archiveSession(s, !s.archived);
                },
              },
              {
                id: "delete",
                label: tr("session.delete"),
                icon: <IconTrash size={16} />,
                danger: true,
                onClick: () => deleteSessionConfirm(s),
              },
            ];
          }
        }
        return (
          <ContextMenu
            open={!!ctxMenu && items.length > 0}
            x={ctxMenu?.x ?? 0}
            y={ctxMenu?.y ?? 0}
            onClose={() => setCtxMenu(null)}
            items={items}
          />
        );
      })()}

      <span hidden data-layout-default={JSON.stringify(DEFAULT_LAYOUT)} />
    </div>
    </ImageViewerProvider>
  );
}
