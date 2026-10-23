/**
 * Scheduled automations workbench — Codex-style “已安排”.
 * Default surface: task list (+ create). Inbox is a tab; runner / honesty /
 * LaunchAgent / one-shot live in the gear modal (warn banner only when at risk).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import * as api from "@/lib/api";
import {
  computeNextRunAt,
  formatNextRunRelative,
  formatScheduleSummary,
  normalizeAutomationSessionMode,
  shortSessionId,
  type Automation,
} from "@/lib/automations";
import { automationsRunnerBanner } from "@/lib/automationsRunnerPolicy";
import {
  automationsHonestyMatrix,
  automationsOneShotHelperSurface,
  deriveAutomationsRunnerSurface,
  launchAgentSoftFail,
  type LaunchAgentSoftFail,
} from "@/lib/automationsHeadlessHonesty";
import {
  AUTOMATION_RUN_HISTORY_CHANGE_EVENT,
  clearAutomationRunHistory,
  loadAutomationRunHistory,
  type AutomationRunOutcomeFilter,
  type AutomationRunRecord,
} from "@/lib/automationRunHistory";
import {
  buildAutomationsInbox,
  clearInboxSeenIds,
  countInboxByOutcome,
  filterInbox,
  loadInboxSeenIds,
  markAllInboxRead,
  markInboxItemRead,
  planOpenInboxItem,
  planRetryAutomation,
  resolveInboxEmptyState,
  type AutomationsInboxItem,
} from "@/lib/automationsInbox";
import { formatRelativeTime } from "@/lib/accountUi";
import { Select } from "@/components/Select";
import { GlassModal } from "@/components/GlassModal";
import {
  IconAutomations,
  IconClose,
  IconMore,
  IconPlus,
  IconScheduled,
  IconSearch,
  IconSettings,
} from "@/components/icons";
import { Tip } from "@/components/ui/tooltip";
import {
  DEFAULT_EFFORT,
  DEFAULT_MODEL_ID,
  effortCatalogForRoute,
  effortOptionsFromProvider,
  findModel,
  GROK_BUILD_EFFORTS,
  GROK_BUILD_MODELS,
  pickDefaultEffort,
  type ModelOption,
} from "@/lib/grokCatalog";
import {
  buildComposerModelGroups,
} from "@/lib/composerModelGroups";
import {
  automationModelValue,
  inferAutomationProviderId,
  normalizeAutomationRoute,
  parseAutomationModelValue,
} from "@/lib/automationModelRoute";
import { resolveProviderEfforts } from "@/lib/providerModelConfig";
import { automationsBackgroundStatus } from "@/lib/automationsBackgroundStatus";

export type AutomationsFilter = "all" | "enabled" | "paused";

export interface AutomationsProjectOption {
  id: string;
  name: string;
  /** SSH projects are pinned to the official route. */
  isSshRemote?: boolean;
}

/** Custom provider channel available for scheduled runs. */
export interface AutomationsProviderOption {
  id: string;
  name: string;
  model: string;
  baseUrl: string;
  models?: { id: string; name: string }[];
  efforts?: { id: string; name?: string; label?: string; isDefault?: boolean }[];
}

/** Chat the user can reuse for a scheduled task. */
export interface AutomationsSessionOption {
  id: string;
  title: string;
  projectId?: string | null;
  updatedAt?: string;
}

export interface AutomationsPageProps {
  t: (key: string, vars?: Record<string, string | number>) => string;
  projects: AutomationsProjectOption[];
  /** Recent chats available for "run in an existing chat". */
  sessionOptions?: AutomationsSessionOption[];
  /** Custom provider channels; official models stay in `models`. */
  providers?: AutomationsProviderOption[];
  /** Provider of the composer's current route (custom id or `official`). */
  defaultProviderId?: string;
  defaultModelId?: string;
  defaultEffort?: string;
  /** Live selectable models; falls back to catalog. */
  models?: ModelOption[];
  onAiCreate: () => void;
  onRunNow?: (auto: Automation) => void | Promise<unknown>;
  /**
   * Open a session linked from an Inbox row (when sessionId was observed).
   * Soft — App resolves live session; may toast if missing.
   */
  onOpenSession?: (sessionId: string, projectId?: string | null) => void;
  /** Focus a project when Inbox row has project but no session. */
  onOpenProject?: (projectId: string) => void;
  /** Locale for relative timestamps in Inbox (default: en). */
  locale?: string;
  /** AppSettings.launchAtLogin — honest background status banner. */
  openAtLogin?: boolean;
  /** Deep-link to Settings → general/app → Launch at login. */
  onOpenLaunchAtLogin?: () => void;
  /** AppSettings.closeToTray */
  closeToTray?: boolean;
  /** AppSettings.keepTrayForSchedules — hide to tray when schedules are on. */
  keepTrayForSchedules?: boolean;
  onKeepTrayForSchedules?: (v: boolean) => void;
  /** Deep-link to Settings → general/app → Keep tray for schedules. */
  onOpenKeepTraySetting?: () => void;
}

type FormState = {
  title: string;
  prompt: string;
  projectId: string; // "" = none
  modelId: string;
  /** `official` or a custom provider id. */
  providerId: string;
  effort: string;
  sessionMode: "new" | "reuse";
  sessionId: string;
  frequency: string;
  time: string;
  notify: string;
  enabled: boolean;
};

const emptyForm = (
  modelId: string,
  effort: string,
  providerId: string,
): FormState => ({
  title: "",
  prompt: "",
  projectId: "",
  modelId,
  providerId,
  effort,
  sessionMode: "new",
  sessionId: "",
  frequency: "daily",
  time: "09:00",
  notify: "all",
  enabled: true,
});

export function AutomationsPage({
  t,
  projects,
  sessionOptions = [],
  providers = [],
  defaultProviderId = "official",
  defaultModelId = DEFAULT_MODEL_ID,
  defaultEffort = DEFAULT_EFFORT,
  models,
  onAiCreate,
  onRunNow,
  onOpenSession,
  onOpenProject,
  locale = "en",
  openAtLogin = false,
  onOpenLaunchAtLogin,
  closeToTray = true,
  keepTrayForSchedules = true,
  onKeepTrayForSchedules,
  onOpenKeepTraySetting,
}: AutomationsPageProps) {
  const [list, setList] = useState<Automation[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<AutomationsFilter>("all");
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  /** Official catalog (live when Host returned one). */
  const modelCatalog = models?.length ? models : GROK_BUILD_MODELS;
  /** Live cache may hide legacy ids; keep the static official set too. */
  const officialModelIds = Array.from(
    new Set([
      ...modelCatalog.map((m) => m.id),
      ...GROK_BUILD_MODELS.map((m) => m.id),
    ]),
  );
  const officialDefaultModelId =
    modelCatalog.find((m) => m.isDefault)?.id ??
    modelCatalog[0]?.id ??
    DEFAULT_MODEL_ID;
  const officialDefaultEffort = pickDefaultEffort(
    findModel(officialDefaultModelId, modelCatalog),
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(() =>
    emptyForm(defaultModelId, defaultEffort, defaultProviderId),
  );
  const [createMenu, setCreateMenu] = useState(false);
  const [rowMenuId, setRowMenuId] = useState<string | null>(null);
  /** Pending delete — never use window.confirm in Tauri WebView. */
  const [deleteTarget, setDeleteTarget] = useState<Automation | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [runnerStatus, setRunnerStatus] =
    useState<api.AutomationRunnerStatusDto | null>(null);
  const [launchAgent, setLaunchAgent] =
    useState<api.SchedulesLaunchAgentStatusDto | null>(null);
  const [launchAgentBusy, setLaunchAgentBusy] = useState(false);
  /** Soft-fail modal when LaunchAgent install/remove/reveal fails (no fake daemon). */
  const [launchAgentFail, setLaunchAgentFail] =
    useState<LaunchAgentSoftFail | null>(null);
  /** Observed schedule run history (local ring; process-bound honesty). */
  const [runHistory, setRunHistory] = useState<AutomationRunRecord[]>(() =>
    loadAutomationRunHistory(),
  );
  /** Inbox filters (outcome chips + search) over the same observed ring. */
  const [inboxOutcome, setInboxOutcome] =
    useState<AutomationRunOutcomeFilter>("all");
  const [inboxQuery, setInboxQuery] = useState("");
  const [inboxSeen, setInboxSeen] = useState<Set<string>>(() =>
    loadInboxSeenIds(),
  );
  const [clearHistoryOpen, setClearHistoryOpen] = useState(false);
  /** Primary surface: task list vs run inbox (default tasks — clean first paint). */
  const [mainTab, setMainTab] = useState<"tasks" | "inbox">("tasks");
  /** Background / runner / advanced config — gear modal, not page chrome. */
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** Honesty matrix + one-shot collapsed under Advanced inside the gear modal. */
  const [settingsAdvancedOpen, setSettingsAdvancedOpen] = useState(false);
  const createBtnRef = useRef<HTMLButtonElement>(null);
  const createMenuRef = useRef<HTMLDivElement>(null);
  const deleteConfirmBtnRef = useRef<HTMLButtonElement>(null);
  const [, setTick] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const rows = await api.automationsList();
      setList(
        rows.map((r) => ({
          ...r,
          weekdays: r.weekdays ?? [],
        })),
      );
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshRunner = useCallback(async () => {
    try {
      const [st, la] = await Promise.all([
        api.automationRunnerStatus(),
        api.schedulesLaunchAgentStatus(),
      ]);
      setRunnerStatus(st);
      setLaunchAgent(la);
    } catch {
      // Browser / missing host — keep prior snapshot.
    }
  }, []);

  useEffect(() => {
    void refresh();
    void refreshRunner();
  }, [refresh, refreshRunner]);

  // Host fires can rewrite an automation row (e.g. a reused chat was deleted
  // and the runner stored its replacement). Refresh the open list in place.
  useEffect(() => {
    if (!api.isTauri()) return;
    let cancelled = false;
    const unsubs: Array<() => void> = [];
    const track = (name: "automation://ran" | "automation://error") => {
      void api
        .listen(name, () => {
          if (!cancelled) void refresh();
        })
        .then((unsub) => {
          if (cancelled) unsub();
          else unsubs.push(unsub);
        })
        .catch(() => {
          /* soft-fail: list still refreshes on next mount */
        });
    };
    track("automation://ran");
    track("automation://error");
    return () => {
      cancelled = true;
      unsubs.forEach((unsub) => unsub());
    };
  }, [refresh]);

  // Refresh runner status occasionally while page is open.
  useEffect(() => {
    const id = window.setInterval(() => void refreshRunner(), 45_000);
    return () => window.clearInterval(id);
  }, [refreshRunner]);

  // Live ring buffer updates from host fires + Run now (App records).
  useEffect(() => {
    const onChange = (ev: Event) => {
      const detail = (ev as CustomEvent<AutomationRunRecord[]>).detail;
      if (Array.isArray(detail)) {
        setRunHistory(detail);
      } else {
        setRunHistory(loadAutomationRunHistory());
      }
    };
    window.addEventListener(AUTOMATION_RUN_HISTORY_CHANGE_EVENT, onChange);
    // Soft reload on mount in case another surface wrote while we were away.
    setRunHistory(loadAutomationRunHistory());
    return () =>
      window.removeEventListener(AUTOMATION_RUN_HISTORY_CHANGE_EVENT, onChange);
  }, []);

  const enabledCount = useMemo(
    () => list.filter((a) => a.enabled).length,
    [list],
  );

  const inboxItems = useMemo(
    () =>
      buildAutomationsInbox(runHistory, {
        seenIds: inboxSeen,
        tasks: list.map((a) => ({
          id: a.id,
          projectId: a.projectId,
          title: a.title,
        })),
      }),
    [runHistory, inboxSeen, list],
  );

  const filteredInbox = useMemo(
    () =>
      filterInbox(inboxItems, {
        outcome: inboxOutcome,
        query: inboxQuery,
      }),
    [inboxItems, inboxOutcome, inboxQuery],
  );

  const inboxCounts = useMemo(
    () => countInboxByOutcome(inboxItems),
    [inboxItems],
  );

  const inboxEmpty = useMemo(
    () =>
      resolveInboxEmptyState({
        totalCount: inboxItems.length,
        filteredCount: filteredInbox.length,
        outcomeFilter: inboxOutcome,
        query: inboxQuery,
      }),
    [inboxItems.length, filteredInbox.length, inboxOutcome, inboxQuery],
  );

  const unreadCount = useMemo(
    () => inboxItems.filter((i) => i.unread).length,
    [inboxItems],
  );

  const confirmClearHistory = () => {
    setRunHistory(clearAutomationRunHistory());
    setInboxSeen(clearInboxSeenIds());
    setClearHistoryOpen(false);
  };

  const onMarkInboxRead = useCallback((item: AutomationsInboxItem) => {
    setInboxSeen(markInboxItemRead(item.id));
  }, []);

  const onMarkAllInboxRead = useCallback(() => {
    setInboxSeen(markAllInboxRead(inboxItems.map((i) => i.id)));
  }, [inboxItems]);

  const onOpenInboxItem = useCallback(
    (item: AutomationsInboxItem) => {
      const plan = planOpenInboxItem(item);
      if (plan.kind === "session") {
        onOpenSession?.(plan.sessionId, plan.projectId ?? item.projectId);
        onMarkInboxRead(item);
        return;
      }
      if (plan.kind === "project") {
        onOpenProject?.(plan.projectId);
        onMarkInboxRead(item);
      }
    },
    [onOpenSession, onOpenProject, onMarkInboxRead],
  );

  const onRetryInboxItem = useCallback(
    (item: AutomationsInboxItem) => {
      const plan = planRetryAutomation(item);
      if (!plan.canRetry || !onRunNow) return;
      const auto = list.find((a) => a.id === plan.taskId);
      if (!auto) return;
      onMarkInboxRead(item);
      void Promise.resolve(onRunNow(auto)).then(() => refresh());
    },
    [list, onRunNow, onMarkInboxRead, refresh],
  );

  const banner = useMemo(
    () =>
      automationsRunnerBanner({
        enabledCount,
        keepTrayForSchedules,
        closeToTray,
        launchAgentSupported: !!launchAgent?.supported,
        launchAgentEnabled: !!launchAgent?.enabled,
        runnerKnown: api.isTauri(),
      }),
    [
      enabledCount,
      keepTrayForSchedules,
      closeToTray,
      launchAgent?.supported,
      launchAgent?.enabled,
    ],
  );

  /** Host runner status surface: last tick + honest pause reason. */
  const runnerSurface = useMemo(
    () =>
      deriveAutomationsRunnerSurface({
        runnerKnown: api.isTauri(),
        running: !!runnerStatus?.running,
        lastTickAt: runnerStatus?.lastTickAt ?? null,
        tickIntervalSecs: runnerStatus?.tickIntervalSecs ?? 30,
        enabledCount,
        closeToTray,
        keepTrayForSchedules,
        launchAgentEnabled: !!launchAgent?.enabled,
      }),
    [
      runnerStatus?.running,
      runnerStatus?.lastTickAt,
      runnerStatus?.tickIntervalSecs,
      enabledCount,
      closeToTray,
      keepTrayForSchedules,
      launchAgent?.enabled,
    ],
  );

  const honestyRows = useMemo(
    () =>
      automationsHonestyMatrix({
        // Always show LaunchAgent row on macOS status; on other platforms hide
        // unless we already know support (desktop macOS = true from host).
        launchAgentSupported:
          launchAgent == null ? true : !!launchAgent.supported,
        // One-shot helper is always available on desktop hosts (flag + script).
        includeOneShot: true,
      }),
    [launchAgent],
  );

  const oneShotSurface = useMemo(() => automationsOneShotHelperSurface(), []);

  const onToggleLaunchAgent = async (next: boolean) => {
    setLaunchAgentBusy(true);
    try {
      const st = await api.schedulesLaunchAgentSetEnabled(next);
      setLaunchAgent(st);
    } catch (e) {
      // Soft-fail: do not flip toggle; GlassModal explains limits.
      setLaunchAgentFail(launchAgentSoftFail(e, next ? "enable" : "disable"));
      try {
        const st = await api.schedulesLaunchAgentStatus();
        setLaunchAgent(st);
      } catch {
        /* keep prior */
      }
    } finally {
      setLaunchAgentBusy(false);
    }
  };

  const onRevealLaunchAgent = async () => {
    try {
      await api.schedulesLaunchAgentRevealHelper();
    } catch (e) {
      setLaunchAgentFail(launchAgentSoftFail(e, "reveal"));
    }
  };

  // Refresh relative "next run" labels once a minute.
  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 60_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!createMenu) return;
    const onDoc = (e: MouseEvent) => {
      const el = e.target as Node;
      if (
        createMenuRef.current?.contains(el) ||
        createBtnRef.current?.contains(el)
      ) {
        return;
      }
      setCreateMenu(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [createMenu]);

  useEffect(() => {
    if (!rowMenuId) return;
    // Close on outside mousedown, but ignore presses inside the open menu
    // (otherwise menu unmounts before click fires → items do nothing).
    const onDoc = (e: MouseEvent) => {
      const el = e.target as Element | null;
      if (el?.closest?.(`[data-auto-row-menu="${rowMenuId}"]`)) return;
      // Keep open when pressing the same row's ⋯ trigger (toggle handled there).
      if (el?.closest?.(`[data-auto-row-trigger="${rowMenuId}"]`)) return;
      setRowMenuId(null);
    };
    const timer = window.setTimeout(
      () => document.addEventListener("mousedown", onDoc),
      0,
    );
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("mousedown", onDoc);
    };
  }, [rowMenuId]);

  const filtered = useMemo(() => {
    let rows = list;
    if (filter === "enabled") rows = rows.filter((a) => a.enabled);
    if (filter === "paused") rows = rows.filter((a) => !a.enabled);
    const q = query.trim().toLowerCase();
    if (q) {
      rows = rows.filter(
        (a) =>
          a.title.toLowerCase().includes(q) ||
          a.prompt.toLowerCase().includes(q),
      );
    }
    return rows;
  }, [list, filter, query]);

  /** Honest quit / background status — no fake detached daemon. */
  const bgStatus = useMemo(
    () =>
      automationsBackgroundStatus({
        openAtLogin,
        enabledCount,
        // Desktop host owns automation_runner; browser dev falls back to unknown.
        runnerKnown: api.isTauri(),
      }),
    [openAtLogin, enabledCount],
  );

  /**
   * Single risk banner for the main page (warn only).
   * Info-level honesty lives in the gear modal — avoids double banners.
   */
  const riskBanner = useMemo(() => {
    if (banner.severity === "warn" && banner.messageKey) {
      return {
        severity: "warn" as const,
        messageKey: banner.messageKey,
        n: enabledCount,
        showKeepTray: !!(banner.showKeepTrayToggle && onKeepTrayForSchedules),
        showOpenSettings: !!onOpenKeepTraySetting,
        showLoginLink: false as boolean,
      };
    }
    if (bgStatus.severity === "warn" && bgStatus.messageKey) {
      return {
        severity: "warn" as const,
        messageKey: bgStatus.messageKey,
        n: bgStatus.enabledCount,
        showKeepTray: false as boolean,
        showOpenSettings: false as boolean,
        showLoginLink: !!(bgStatus.showOpenAtLoginLink && onOpenLaunchAtLogin),
      };
    }
    return null;
  }, [
    banner.severity,
    banner.messageKey,
    banner.showKeepTrayToggle,
    enabledCount,
    onKeepTrayForSchedules,
    onOpenKeepTraySetting,
    bgStatus.severity,
    bgStatus.messageKey,
    bgStatus.enabledCount,
    bgStatus.showOpenAtLoginLink,
    onOpenLaunchAtLogin,
  ]);

  /** Compact header status pill (details in gear modal). */
  const statusPill = useMemo(() => {
    if (enabledCount <= 0) {
      return { tone: "idle" as const, labelKey: "automations.status.idle" };
    }
    if (banner.severity === "warn" || bgStatus.severity === "warn") {
      return { tone: "warn" as const, labelKey: "automations.status.atRisk" };
    }
    if (runnerSurface.phase === "running") {
      return { tone: "ok" as const, labelKey: "automations.status.active" };
    }
    return { tone: "idle" as const, labelKey: "automations.status.unknown" };
  }, [
    enabledCount,
    banner.severity,
    bgStatus.severity,
    runnerSurface.phase,
  ]);

  const openCreateManual = () => {
    setCreateMenu(false);
    setEditingId(null);
    const route = normalizeAutomationRoute({
      providerId: defaultProviderId,
      modelId: defaultModelId,
      officialModelIds,
      officialDefaultModelId,
      providers,
    });
    setForm(emptyForm(route.modelId, defaultEffort, route.providerId));
    setPanelOpen(true);
  };

  const openEdit = (auto: Automation) => {
    setRowMenuId(null);
    setEditingId(auto.id);
    const project = projects.find((p) => p.id === auto.projectId);
    const inferredProvider = project?.isSshRemote
      ? "official"
      : inferAutomationProviderId({
          providerId: auto.providerId,
          modelId: auto.modelId,
          officialModelIds,
          providers,
          fallbackProviderId: defaultProviderId,
        });
    const route = normalizeAutomationRoute({
      providerId: inferredProvider,
      modelId: project?.isSshRemote
        ? officialDefaultModelId
        : auto.modelId || defaultModelId,
      officialModelIds,
      officialDefaultModelId,
      providers,
    });
    setForm({
      title: auto.title,
      prompt: auto.prompt,
      projectId: auto.projectId ?? "",
      modelId: route.modelId,
      providerId: route.providerId,
      effort: project?.isSshRemote
        ? officialDefaultEffort
        : auto.effort || defaultEffort,
      sessionMode: normalizeAutomationSessionMode(
        auto.sessionMode,
        auto.sessionId,
      ),
      sessionId:
        normalizeAutomationSessionMode(auto.sessionMode, auto.sessionId) ===
        "reuse"
          ? (auto.sessionId ?? "")
          : "",
      frequency: auto.frequency || "daily",
      time: auto.time || "09:00",
      notify: auto.notify || "all",
      enabled: auto.enabled,
    });
    setPanelOpen(true);
  };

  const closePanel = () => {
    setPanelOpen(false);
    setEditingId(null);
  };

  const saveForm = async () => {
    const title = form.title.trim();
    const prompt = form.prompt.trim();
    if (!title) {
      setError(t("automations.errTitle"));
      return;
    }
    if (!prompt) {
      setError(t("automations.errPrompt"));
      return;
    }
    if (form.sessionMode === "reuse" && !form.sessionId) {
      setError(t("automations.errSession"));
      return;
    }
    const nextRunAt = computeNextRunAt({
      frequency: form.frequency,
      time: form.time,
      weekdays: [],
      enabled: form.enabled,
    });
    const route = normalizeAutomationRoute({
      providerId: form.providerId,
      modelId: form.modelId,
      officialModelIds,
      officialDefaultModelId,
      providers,
    });
    const input: api.AutomationInputDto = {
      title,
      prompt,
      enabled: form.enabled,
      projectId: form.projectId || null,
      modelId: route.modelId || null,
      providerId: route.providerId || null,
      effort: form.effort || null,
      sessionMode: form.sessionMode,
      sessionId: form.sessionMode === "reuse" ? form.sessionId : null,
      frequency: form.frequency,
      time: form.time,
      weekdays: [],
      notify: form.notify,
      nextRunAt,
    };
    try {
      if (editingId) {
        await api.automationUpdate(editingId, input);
      } else {
        await api.automationCreate(input);
      }
      closePanel();
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  };

  const toggleEnabled = async (auto: Automation) => {
    setRowMenuId(null);
    try {
      const next = await api.automationSetEnabled(auto.id, !auto.enabled);
      if (next.enabled && !next.nextRunAt) {
        const nr = computeNextRunAt(next as Automation);
        if (nr) {
          await api.automationUpdate(auto.id, {
            title: next.title,
            prompt: next.prompt,
            enabled: true,
            projectId: next.projectId,
            modelId: next.modelId,
            providerId: next.providerId,
            effort: next.effort,
            sessionMode: next.sessionMode,
            sessionId: next.sessionId,
            frequency: next.frequency,
            time: next.time,
            weekdays: next.weekdays,
            notify: next.notify,
            nextRunAt: nr,
          });
        }
      }
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  };

  const requestRemove = (auto: Automation) => {
    setRowMenuId(null);
    setDeleteTarget(auto);
  };

  const confirmRemove = async () => {
    const auto = deleteTarget;
    if (!auto || deleting) return;
    setDeleting(true);
    try {
      await api.automationDelete(auto.id);
      setDeleteTarget(null);
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setDeleting(false);
    }
  };

  useEffect(() => {
    if (!deleteTarget) return;
    const t = window.setTimeout(() => deleteConfirmBtnRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [deleteTarget]);

  const scheduleLabels = {
    daily: t("automations.freq.daily"),
    weekly: t("automations.freq.weekly"),
    weekdays: t("automations.freq.weekdays"),
    once: t("automations.freq.once"),
    at: t("automations.at"),
  };

  const relativeLabels = {
    overdue: t("automations.next.overdue"),
    inHours: t("automations.next.inHours"),
    inDays: t("automations.next.inDays"),
    inMinutes: t("automations.next.inMinutes"),
    unknown: t("automations.next.unknown"),
  };

  const projectOptions = useMemo(
    () => [
      { value: "", label: t("automations.projectNone") },
      ...projects.map((p) => ({ value: p.id, label: p.name })),
    ],
    [projects, t],
  );

  const runInOptions = [
    { value: "new", label: t("automations.sessionMode.new") },
    { value: "reuse", label: t("automations.sessionMode.reuse") },
  ];

  const sessionPickerOptions = useMemo(() => {
    const rows: Array<{ value: string; label: string; disabled?: boolean }> =
      sessionOptions.map((s) => {
        const projectName = s.projectId
          ? projects.find((p) => p.id === s.projectId)?.name
          : null;
        const stamp = s.updatedAt
          ? s.updatedAt.slice(5, 16).replace("T", " ")
          : "";
        return {
          value: s.id,
          label: [
            s.title || t("session.untitled"),
            projectName || t("automations.projectNone"),
            `#${shortSessionId(s.id)}`,
            stamp,
          ]
            .filter(Boolean)
            .join(" · "),
          // Built once per list change; the menu filters without re-casing.
          keywords: [s.title, s.id, projectName ?? ""]
            .join(" ")
            .toLowerCase(),
        };
      });
    // The current pick must stay visible (and selectable) under any filter.
    if (form.sessionId && !rows.some((r) => r.value === form.sessionId)) {
      rows.unshift({
        value: form.sessionId,
        label: `${t("automations.sessionMissing")} · #${shortSessionId(form.sessionId)}`,
      });
    }
    if (!form.sessionId) {
      rows.unshift({
        value: "",
        label: t("automations.sessionNone"),
        disabled: true,
      });
    }
    return rows;
  }, [form.sessionId, projects, sessionOptions, t]);

  const selectedProject = projects.find((p) => p.id === form.projectId);
  const effectiveProviders = selectedProject?.isSshRemote ? [] : providers;
  const modelGroups = buildComposerModelGroups({
    officialModels: modelCatalog,
    providers: effectiveProviders,
    officialGroupTitle: t("composer.modelGroupOfficial"),
  });
  const modelOptions = modelGroups.flatMap((group) =>
    group.entries.map((entry) => ({
      value: automationModelValue(entry.pick),
      label: `${group.title} · ${entry.title}`,
    })),
  );
  // `""` is a legacy row with no route: keep whatever route is active.
  const activeRouteValue = `active:${form.modelId}`;
  const currentModelValue =
    form.providerId === ""
      ? activeRouteValue
      : automationModelValue(
          form.providerId !== "official"
            ? {
                kind: "custom",
                providerId: form.providerId,
                modelId: form.modelId,
              }
            : { kind: "official", modelId: form.modelId },
        );
  if (!modelOptions.some((o) => o.value === currentModelValue)) {
    modelOptions.unshift({
      value: currentModelValue,
      label:
        form.providerId === ""
          ? t("automations.modelActiveRoute", {
              model: form.modelId || "—",
            })
          : form.modelId,
    });
  }

  const selectedProvider = effectiveProviders.find(
    (p) => p.id === form.providerId,
  );
  const selectedEfforts = selectedProvider
    ? effortOptionsFromProvider(
        resolveProviderEfforts(selectedProvider, form.modelId),
      ) ?? GROK_BUILD_EFFORTS
    : effortCatalogForRoute({
        model: findModel(form.modelId, modelCatalog),
      });
  const effortOptions = selectedEfforts.map((e) => ({
    value: e.id,
    label:
      e.label ||
      (["low", "medium", "high", "xhigh"].includes(e.id)
        ? t(`effort.${e.id}` as "effort.high")
        : e.id),
  }));

  // A legacy effort may not exist on the selected model's ladder. Clamp it
  // before save so the stored value is one the CLI actually accepts.
  useEffect(() => {
    if (!panelOpen || effortOptions.some((o) => o.value === form.effort)) {
      return;
    }
    const fallback =
      selectedEfforts.find((e) => e.isDefault)?.id ?? effortOptions[0]?.value;
    if (fallback) {
      setForm((f) => ({ ...f, effort: fallback }));
    }
  }, [form.effort, effortOptions, panelOpen, selectedEfforts]);

  const freqOptions = [
    { value: "daily", label: t("automations.freq.daily") },
    { value: "weekdays", label: t("automations.freq.weekdays") },
    { value: "weekly", label: t("automations.freq.weekly") },
    { value: "once", label: t("automations.freq.once") },
  ];

  const timeOptions = useMemo(() => {
    const opts: { value: string; label: string }[] = [];
    for (let h = 0; h < 24; h++) {
      for (const m of [0, 30]) {
        const value = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
        opts.push({ value, label: value });
      }
    }
    // Ensure current form time is present even if not on 30-min grid.
    if (form.time && !opts.some((o) => o.value === form.time)) {
      opts.unshift({ value: form.time, label: form.time });
    }
    return opts;
  }, [form.time]);

  const notifyOptions = [
    { value: "all", label: t("automations.notify.all") },
    { value: "failures", label: t("automations.notify.failures") },
    { value: "none", label: t("automations.notify.none") },
  ];

  return (
    <div className="auto-page">
      <div className="auto-page__head">
        <div className="auto-page__titles">
          <h1 className="auto-page__title">{t("automations.title")}</h1>
          <p className="auto-page__subtitle">{t("automations.subtitle")}</p>
        </div>
        <div className="auto-page__head-actions">
          <button
            type="button"
            className={
              "auto-page__status-pill" +
              (statusPill.tone === "ok"
                ? " auto-page__status-pill--ok"
                : statusPill.tone === "warn"
                  ? " auto-page__status-pill--warn"
                  : " auto-page__status-pill--idle")
            }
            onClick={() => {
              setSettingsAdvancedOpen(false);
              setSettingsOpen(true);
            }}
            aria-label={t(statusPill.labelKey)}
            title={t(statusPill.labelKey)}
          >
            <span className="auto-page__status-dot" aria-hidden />
            <span className="auto-page__status-label">
              {t(statusPill.labelKey)}
            </span>
          </button>
          <Tip label={t("automations.settings.aria")}>
            <button
              type="button"
              className="tree-icon-btn auto-page__settings-btn"
              onClick={() => {
                setSettingsAdvancedOpen(false);
                setSettingsOpen(true);
              }}
              aria-label={t("automations.settings.aria")}
            >
              <IconSettings size={16} />
            </button>
          </Tip>
          <div className="auto-page__create-wrap">
            <button
              ref={createBtnRef}
              type="button"
              className="auto-page__create"
              onClick={() => setCreateMenu((v) => !v)}
            >
              {t("automations.create")}
              <span className="auto-page__create-caret" aria-hidden>
                ▾
              </span>
            </button>
            {createMenu && (
              <div
                ref={createMenuRef}
                className="menu-panel auto-page__create-menu"
                role="menu"
              >
                <button
                  type="button"
                  className="auto-page__create-item"
                  role="menuitem"
                  onClick={() => {
                    setCreateMenu(false);
                    onAiCreate();
                  }}
                >
                  <IconAutomations size={16} />
                  <span>
                    <strong>{t("automations.createAi")}</strong>
                    <em>{t("automations.createAiHint")}</em>
                  </span>
                </button>
                <button
                  type="button"
                  className="auto-page__create-item"
                  role="menuitem"
                  onClick={openCreateManual}
                >
                  <IconPlus size={16} />
                  <span>
                    <strong>{t("automations.createManual")}</strong>
                    <em>{t("automations.createManualHint")}</em>
                  </span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {riskBanner ? (
        <div
          className={
            "auto-page__bg-banner auto-page__bg-banner--warn"
          }
          role="status"
        >
          <p className="auto-page__bg-banner-text">
            {t(riskBanner.messageKey, { n: riskBanner.n })}
          </p>
          {riskBanner.showKeepTray ? (
            <button
              type="button"
              className="auto-page__bg-banner-link"
              onClick={() => onKeepTrayForSchedules?.(!keepTrayForSchedules)}
            >
              {t("automations.risk.enableKeepTray")}
            </button>
          ) : null}
          {riskBanner.showOpenSettings && onOpenKeepTraySetting ? (
            <button
              type="button"
              className="auto-page__bg-banner-link"
              onClick={onOpenKeepTraySetting}
            >
              {t("automations.runner.openSettings")}
            </button>
          ) : null}
          {riskBanner.showLoginLink && onOpenLaunchAtLogin ? (
            <button
              type="button"
              className="auto-page__bg-banner-link"
              onClick={onOpenLaunchAtLogin}
            >
              {t("automations.bg.openAtLoginLink")}
            </button>
          ) : null}
        </div>
      ) : null}

      <div
        className="auto-page__tabs"
        role="tablist"
        aria-label={t("automations.tabs.aria")}
      >
        <button
          type="button"
          role="tab"
          aria-selected={mainTab === "tasks"}
          className={
            "auto-page__tab" + (mainTab === "tasks" ? " is-active" : "")
          }
          onClick={() => setMainTab("tasks")}
        >
          {t("automations.tab.tasks")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mainTab === "inbox"}
          className={
            "auto-page__tab" + (mainTab === "inbox" ? " is-active" : "")
          }
          onClick={() => setMainTab("inbox")}
        >
          {t("automations.tab.inbox")}
          {unreadCount > 0 ? (
            <span
              className="auto-page__inbox-unread"
              aria-label={t("automations.inbox.unreadCount", {
                n: unreadCount,
              })}
            >
              {unreadCount}
            </span>
          ) : null}
        </button>
      </div>

      {error && (
        <div className="auto-page__error" role="alert">
          {error}
          <button type="button" onClick={() => setError(null)}>
            <IconClose size={14} />
          </button>
        </div>
      )}

      {mainTab === "tasks" ? (
        <>
          <div className="auto-page__toolbar">
            <div className="auto-page__search">
              <IconSearch size={15} />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("automations.search")}
                aria-label={t("automations.search")}
              />
            </div>
            <div className="auto-page__filters" role="tablist">
              {(
                [
                  ["all", "automations.filter.all"],
                  ["enabled", "automations.filter.enabled"],
                  ["paused", "automations.filter.paused"],
                ] as const
              ).map(([id, key]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={filter === id}
                  className={
                    "auto-page__filter" + (filter === id ? " is-active" : "")
                  }
                  onClick={() => setFilter(id)}
                >
                  {t(key)}
                </button>
              ))}
            </div>
          </div>

          <div className="auto-page__body">
            {loading ? (
              <div className="auto-page__empty">{t("automations.loading")}</div>
            ) : filtered.length === 0 ? (
              <div className="auto-page__empty">
                <IconScheduled size={28} />
                <strong>{t("automations.emptyTitle")}</strong>
                <span>{t("automations.emptyHint")}</span>
                <div className="auto-page__empty-actions">
                  <button
                    type="button"
                    className="btn btn--solid"
                    onClick={onAiCreate}
                  >
                    {t("automations.createAi")}
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost"
                    onClick={openCreateManual}
                  >
                    {t("automations.createManual")}
                  </button>
                </div>
              </div>
            ) : (
              <ul className="auto-list">
                {filtered.map((auto) => {
                  const next =
                    auto.nextRunAt ||
                    (auto.enabled ? computeNextRunAt(auto) : null);
                  const projectName = auto.projectId
                    ? projects.find((p) => p.id === auto.projectId)?.name
                    : null;
                  return (
                    <li
                      key={auto.id}
                      className={
                        "auto-row" +
                        (!auto.enabled ? " auto-row--paused" : "") +
                        (rowMenuId === auto.id ? " auto-row--menu-open" : "")
                      }
                    >
                      <span
                        className={
                          "auto-row__dot" +
                          (auto.enabled ? " is-on" : " is-off")
                        }
                        aria-hidden
                      />
                      <button
                        type="button"
                        className="auto-row__main"
                        onClick={() => openEdit(auto)}
                      >
                        <span className="auto-row__title">{auto.title}</span>
                        <span className="auto-row__meta">
                          {formatScheduleSummary(auto, scheduleLabels)}
                          {" · "}
                          {auto.enabled
                            ? formatNextRunRelative(
                                next,
                                new Date(),
                                relativeLabels,
                              )
                            : t("automations.filter.paused")}
                          {projectName ? ` · ${projectName}` : ""}
                        </span>
                      </button>
                      <div className="auto-row__actions">
                        <Tip label={t("automations.menu")}>
                          <button
                            type="button"
                            className="tree-icon-btn"
                            data-auto-row-trigger={auto.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              setRowMenuId((id) =>
                                id === auto.id ? null : auto.id,
                              );
                            }}
                          >
                            <IconMore size={15} />
                          </button>
                        </Tip>
                        {rowMenuId === auto.id && (
                          <div
                            className="menu-panel auto-row__menu"
                            role="menu"
                            data-auto-row-menu={auto.id}
                            onMouseDown={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => openEdit(auto)}
                            >
                              {t("automations.edit")}
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                setRowMenuId(null);
                                void toggleEnabled(auto);
                              }}
                            >
                              {auto.enabled
                                ? t("automations.pause")
                                : t("automations.resume")}
                            </button>
                            {onRunNow && (
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() => {
                                  setRowMenuId(null);
                                  void Promise.resolve(onRunNow(auto)).then(
                                    () => refresh(),
                                  );
                                }}
                              >
                                {t("automations.runNow")}
                              </button>
                            )}
                            <button
                              type="button"
                              role="menuitem"
                              className="is-danger"
                              onClick={() => requestRemove(auto)}
                            >
                              {t("automations.delete")}
                            </button>
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      ) : (
        <div
          className="auto-page__history auto-page__inbox auto-page__inbox--tab"
          role="tabpanel"
          aria-label={t("automations.inbox.section")}
        >
          <div className="auto-page__history-head">
            <div className="auto-page__history-titles">
              <p className="auto-page__history-desc">
                {t("automations.inbox.shortDesc")}
              </p>
            </div>
            <div className="auto-page__inbox-head-actions">
              {unreadCount > 0 ? (
                <button
                  type="button"
                  className="auto-page__bg-banner-link"
                  onClick={onMarkAllInboxRead}
                >
                  {t("automations.inbox.markAllRead")}
                </button>
              ) : null}
              {runHistory.length > 0 ? (
                <button
                  type="button"
                  className="auto-page__bg-banner-link"
                  onClick={() => setClearHistoryOpen(true)}
                >
                  {t("automations.inbox.clear")}
                </button>
              ) : null}
            </div>
          </div>

          {!inboxEmpty || inboxItems.length > 0 ? (
            <div className="auto-page__inbox-toolbar">
              <div className="auto-page__search auto-page__inbox-search">
                <IconSearch size={14} />
                <input
                  type="search"
                  value={inboxQuery}
                  onChange={(e) => setInboxQuery(e.target.value)}
                  placeholder={t("automations.inbox.search")}
                  aria-label={t("automations.inbox.search")}
                />
              </div>
              <div
                className="auto-page__history-filters"
                role="tablist"
                aria-label={t("automations.inbox.filterAria")}
              >
                {(
                  [
                    ["all", "automations.history.filter.all"],
                    ["ok", "automations.history.filter.ok"],
                    ["error", "automations.history.filter.error"],
                    ["skipped", "automations.history.filter.skipped"],
                  ] as const
                ).map(([id, key]) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={inboxOutcome === id}
                    className={
                      "auto-page__filter" +
                      (inboxOutcome === id ? " is-active" : "")
                    }
                    onClick={() => setInboxOutcome(id)}
                  >
                    {t(key)}
                    <span className="auto-page__history-count" aria-hidden>
                      {inboxCounts[id]}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {inboxEmpty ? (
            <div className="auto-page__history-empty" role="status">
              {inboxEmpty === "filter"
                ? t("automations.inbox.emptyFiltered")
                : inboxEmpty === "process_bound_hint"
                  ? t("automations.inbox.emptyProcessBound")
                  : t("automations.inbox.empty")}
            </div>
          ) : (
            <ul className="auto-page__history-list auto-page__inbox-list">
              {filteredInbox.map((row) => {
                const when = formatRelativeTime(row.at, locale);
                const outcomeKey =
                  row.outcome === "ok"
                    ? "automations.history.outcome.ok"
                    : row.outcome === "error"
                      ? "automations.history.outcome.error"
                      : "automations.history.outcome.skipped";
                const sourceKey =
                  row.source === "host"
                    ? "automations.history.source.host"
                    : row.source === "run_now"
                      ? "automations.history.source.runNow"
                      : "automations.history.source.unknown";
                const openPlan = planOpenInboxItem(row);
                const retryPlan = planRetryAutomation(row);
                return (
                  <li
                    key={row.id}
                    className={
                      "auto-page__history-row auto-page__inbox-row" +
                      (row.outcome === "error"
                        ? " auto-page__history-row--error"
                        : row.outcome === "skipped"
                          ? " auto-page__history-row--skipped"
                          : "") +
                      (row.unread ? " auto-page__inbox-row--unread" : "")
                    }
                  >
                    <span
                      className={
                        "auto-page__history-outcome" +
                        ` auto-page__history-outcome--${row.outcome}`
                      }
                    >
                      {t(outcomeKey)}
                    </span>
                    <div className="auto-page__history-main">
                      <span className="auto-page__history-name">
                        {row.unread ? (
                          <span
                            className="auto-page__inbox-dot"
                            aria-hidden
                          />
                        ) : null}
                        {row.title}
                      </span>
                      <span className="auto-page__history-meta">
                        <time dateTime={row.at} title={row.at}>
                          {when}
                        </time>
                        {" · "}
                        {t(sourceKey)}
                      </span>
                      {row.outcome === "error" && row.error ? (
                        <span
                          className="auto-page__history-error"
                          title={row.error}
                        >
                          {row.error}
                        </span>
                      ) : null}
                      <div className="auto-page__inbox-actions">
                        {openPlan.kind !== "none" &&
                        (onOpenSession || onOpenProject) ? (
                          <button
                            type="button"
                            className="auto-page__inbox-action"
                            onClick={() => onOpenInboxItem(row)}
                          >
                            {openPlan.kind === "session"
                              ? t("automations.inbox.openSession")
                              : t("automations.inbox.openProject")}
                          </button>
                        ) : null}
                        {retryPlan.canRetry && onRunNow ? (
                          <button
                            type="button"
                            className="auto-page__inbox-action"
                            onClick={() => onRetryInboxItem(row)}
                          >
                            {t("automations.inbox.runNow")}
                          </button>
                        ) : null}
                        {row.unread ? (
                          <button
                            type="button"
                            className="auto-page__inbox-action"
                            onClick={() => onMarkInboxRead(row)}
                          >
                            {t("automations.inbox.markRead")}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      <GlassModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        title={t("automations.settings.title")}
        size="lg"
        wrapBody
        bodyClassName="auto-page__settings-body"
        closeLabel={t("common.close")}
        footer={
          <button
            type="button"
            className="btn btn--solid"
            onClick={() => setSettingsOpen(false)}
          >
            {t("common.close")}
          </button>
        }
      >
        <div className="auto-page__settings-modal">
          <div className="auto-page__bg-rows">
            <div className="auto-page__bg-row">
              <div className="auto-page__bg-row-text">
                <div className="auto-page__bg-row-label">
                  {t("automations.runner.statusLabel")}
                </div>
                <div className="auto-page__bg-row-desc">
                  {runnerSurface.phase === "running"
                    ? t("automations.runner.statusRunning", {
                        secs: runnerSurface.tickIntervalSecs,
                      })
                    : t("automations.runner.statusIdle")}
                  {runnerSurface.lastTickAt
                    ? ` · ${t("automations.runner.lastTick", {
                        time: new Date(
                          runnerSurface.lastTickAt,
                        ).toLocaleTimeString(),
                      })}`
                    : ""}
                </div>
                {runnerSurface.severity !== "none" ||
                runnerSurface.pausedReason === "no_enabled" ? (
                  <div
                    className={
                      "auto-page__runner-reason" +
                      (runnerSurface.severity === "warn"
                        ? " auto-page__runner-reason--warn"
                        : runnerSurface.severity === "info"
                          ? " auto-page__runner-reason--info"
                          : "")
                    }
                    role="status"
                  >
                    {t(runnerSurface.pausedReasonKey)}
                  </div>
                ) : null}
              </div>
            </div>

            {onKeepTrayForSchedules ? (
              <div className="auto-page__bg-row">
                <div className="auto-page__bg-row-text">
                  <div className="auto-page__bg-row-label">
                    {t("settings.keepTrayForSchedules")}
                  </div>
                  <div className="auto-page__bg-row-desc">
                    {t("settings.keepTrayForSchedulesDesc")}
                  </div>
                </div>
                <label className="auto-page__switch">
                  <input
                    type="checkbox"
                    checked={!!keepTrayForSchedules}
                    onChange={() =>
                      onKeepTrayForSchedules(!keepTrayForSchedules)
                    }
                    aria-label={t("settings.keepTrayForSchedules")}
                  />
                  <span className="auto-page__switch-ui" aria-hidden />
                </label>
              </div>
            ) : null}

            {onOpenLaunchAtLogin ? (
              <div className="auto-page__bg-row">
                <div className="auto-page__bg-row-text">
                  <div className="auto-page__bg-row-label">
                    {t("settings.launchAtLogin")}
                  </div>
                  <div className="auto-page__bg-row-desc">
                    {t("settings.launchAtLoginDesc")}
                  </div>
                  <div className="auto-page__bg-row-actions">
                    <button
                      type="button"
                      className="auto-page__bg-banner-link"
                      onClick={() => {
                        setSettingsOpen(false);
                        onOpenLaunchAtLogin();
                      }}
                    >
                      {t("automations.bg.openAtLoginLink")}
                    </button>
                  </div>
                </div>
                <span className="auto-page__settings-flag" aria-hidden>
                  {openAtLogin
                    ? t("automations.settings.on")
                    : t("automations.settings.off")}
                </span>
              </div>
            ) : null}

            {launchAgent?.supported ? (
              <div className="auto-page__bg-row">
                <div className="auto-page__bg-row-text">
                  <div className="auto-page__bg-row-label">
                    {t("automations.launchAgent.title")}
                  </div>
                  <div className="auto-page__bg-row-desc">
                    {t("automations.launchAgent.desc")}
                  </div>
                  <div className="auto-page__bg-row-actions">
                    <button
                      type="button"
                      className="auto-page__bg-banner-link"
                      onClick={() => void onRevealLaunchAgent()}
                    >
                      {t("automations.launchAgent.reveal")}
                    </button>
                  </div>
                </div>
                <label className="auto-page__switch">
                  <input
                    type="checkbox"
                    checked={!!launchAgent.enabled}
                    disabled={launchAgentBusy}
                    onChange={() =>
                      void onToggleLaunchAgent(!launchAgent.enabled)
                    }
                    aria-label={t("automations.launchAgent.title")}
                  />
                  <span className="auto-page__switch-ui" aria-hidden />
                </label>
              </div>
            ) : null}
          </div>

          <button
            type="button"
            className="auto-page__settings-advanced-toggle"
            aria-expanded={settingsAdvancedOpen}
            onClick={() => setSettingsAdvancedOpen((v) => !v)}
          >
            {t("automations.settings.advanced")}
            <span aria-hidden>{settingsAdvancedOpen ? "▴" : "▾"}</span>
          </button>

          {settingsAdvancedOpen ? (
            <div className="auto-page__settings-advanced">
              <div
                className="auto-page__honesty"
                role="group"
                aria-label={t("automations.honesty.legend")}
              >
                <div className="auto-page__honesty-title">
                  {t("automations.honesty.legend")}
                </div>
                <ul className="auto-page__honesty-list">
                  {honestyRows.map((row) => (
                    <li key={row.id} className="auto-page__honesty-item">
                      <strong className="auto-page__honesty-item-title">
                        {t(row.titleKey)}
                      </strong>
                      <span className="auto-page__honesty-item-body">
                        {t(row.bodyKey)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="auto-page__bg-rows">
                <div className="auto-page__bg-row">
                  <div className="auto-page__bg-row-text">
                    <div className="auto-page__bg-row-label">
                      {t(oneShotSurface.titleKey)}
                    </div>
                    <div className="auto-page__bg-row-desc">
                      {t(oneShotSurface.bodyKey, {
                        flag: oneShotSurface.flagHint,
                        script: oneShotSurface.scriptName,
                      })}
                    </div>
                    <div className="auto-page__bg-row-desc auto-page__bg-row-desc--muted">
                      {t(oneShotSurface.honestyKey)}
                    </div>
                    <div className="auto-page__bg-row-actions">
                      <button
                        type="button"
                        className="auto-page__bg-banner-link"
                        onClick={() => void onRevealLaunchAgent()}
                      >
                        {t("automations.oneshot.reveal")}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </GlassModal>

      <GlassModal
        open={!!launchAgentFail}
        onClose={() => setLaunchAgentFail(null)}
        title={
          launchAgentFail
            ? t(launchAgentFail.titleKey)
            : t("automations.launchAgent.failTitle")
        }
        size="sm"
        closeLabel={t("common.close")}
        footer={
          <button
            type="button"
            className="btn btn--solid"
            onClick={() => setLaunchAgentFail(null)}
          >
            {t("common.close")}
          </button>
        }
      >
        {launchAgentFail ? (
          <>
            <p className="app-dialog__msg">{t(launchAgentFail.bodyKey)}</p>
            <p className="app-dialog__msg app-dialog__msg--muted">
              {t(launchAgentFail.honestyKey)}
            </p>
            {launchAgentFail.detail ? (
              <pre className="auto-page__fail-detail" tabIndex={0}>
                {launchAgentFail.detail}
              </pre>
            ) : null}
          </>
        ) : null}
      </GlassModal>

      <GlassModal
        open={clearHistoryOpen}
        onClose={() => setClearHistoryOpen(false)}
        title={t("automations.inbox.clearTitle")}
        size="sm"
        closeLabel={t("common.close")}
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setClearHistoryOpen(false)}
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn--danger"
              onClick={confirmClearHistory}
            >
              {t("automations.inbox.clearConfirm")}
            </button>
          </>
        }
      >
        <p className="app-dialog__msg">{t("automations.inbox.clearBody")}</p>
        <p className="app-dialog__msg app-dialog__msg--muted">
          {t("automations.inbox.processBound")}
        </p>
      </GlassModal>

      {deleteTarget &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="overlay app-dialog-overlay"
            role="presentation"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget && !deleting) {
                setDeleteTarget(null);
              }
            }}
          >
            <div
              className="modal app-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="auto-delete-title"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <header className="modal-head">
                <h2 id="auto-delete-title" className="modal-title">
                  {t("automations.delete")}
                </h2>
                <button
                  type="button"
                  className="icon-btn modal-close"
                  disabled={deleting}
                  onClick={() => setDeleteTarget(null)}
                  aria-label={t("common.close")}
                >
                  <IconClose size={16} />
                </button>
              </header>
              <form
                className="app-dialog__form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void confirmRemove();
                }}
              >
                <p className="app-dialog__msg">
                  {t("automations.deleteConfirm", {
                    title: deleteTarget.title,
                  })}
                </p>
                <div className="app-dialog__actions modal-actions">
                  <button
                    type="button"
                    className="btn btn--ghost"
                    disabled={deleting}
                    onClick={() => setDeleteTarget(null)}
                  >
                    {t("common.cancel")}
                  </button>
                  <button
                    ref={deleteConfirmBtnRef}
                    type="submit"
                    className="btn btn--danger"
                    disabled={deleting}
                  >
                    {t("automations.delete")}
                  </button>
                </div>
              </form>
            </div>
          </div>,
          document.body,
        )}

      {panelOpen && (
        <aside className="auto-panel" aria-label={t("automations.formTitle")}>
          <div className="auto-panel__head">
            <h2>
              {editingId
                ? t("automations.editTitle")
                : t("automations.formTitle")}
            </h2>
            <Tip label={t("common.close")}>
              <button
                type="button"
                className="chrome-btn"
                onClick={closePanel}
              >
                <IconClose size={16} />
              </button>
            </Tip>
          </div>
          <div className="auto-panel__body">
            <label className="auto-field">
              <span>{t("automations.field.title")}</span>
              <input
                type="text"
                value={form.title}
                onChange={(e) =>
                  setForm((f) => ({ ...f, title: e.target.value }))
                }
                placeholder={t("automations.field.titlePh")}
              />
            </label>
            <label className="auto-field">
              <span>{t("automations.field.prompt")}</span>
              <textarea
                rows={5}
                value={form.prompt}
                onChange={(e) =>
                  setForm((f) => ({ ...f, prompt: e.target.value }))
                }
                placeholder={t("automations.field.promptPh")}
              />
            </label>

            <div className="auto-panel__section">
              <div className="auto-panel__section-label">
                {t("automations.section.details")}
              </div>
              <div className="auto-field auto-field--row">
                <span>{t("automations.field.project")}</span>
                <Select
                  value={form.projectId}
                  options={projectOptions}
                  disabled={form.sessionMode === "reuse"}
                  onChange={(v) =>
                    setForm((f) => {
                      // SSH runs are pinned to the official route.
                      if (projects.find((p) => p.id === v)?.isSshRemote) {
                        return {
                          ...f,
                          projectId: v,
                          providerId: "official",
                          modelId: officialDefaultModelId,
                          effort: officialDefaultEffort,
                        };
                      }
                      return { ...f, projectId: v };
                    })
                  }
                  aria-label={t("automations.field.project")}
                />
              </div>
              <div className="auto-field auto-field--row">
                <span>{t("automations.field.runIn")}</span>
                <Select
                  value={form.sessionMode}
                  options={runInOptions}
                  onChange={(v) =>
                    setForm((f) => ({
                      ...f,
                      sessionMode: v === "reuse" ? "reuse" : "new",
                      sessionId: v === "reuse" ? f.sessionId : "",
                    }))
                  }
                  aria-label={t("automations.field.runIn")}
                />
              </div>
              {form.sessionMode === "new" ? (
                <>
                  <div className="auto-field auto-field--row">
                    <span>{t("automations.field.model")}</span>
                    <Select
                      value={currentModelValue}
                      options={modelOptions}
                      onChange={(v) => {
                        const pick = parseAutomationModelValue(v);
                        if (!pick) return;
                        const nextProvider =
                          pick.kind === "official"
                            ? "official"
                            : pick.providerId;
                        const nextEfforts =
                          pick.kind === "official"
                            ? effortCatalogForRoute({
                                model: findModel(pick.modelId, modelCatalog),
                              })
                            : (() => {
                                const provider = effectiveProviders.find(
                                  (p) => p.id === pick.providerId,
                                );
                                return provider
                                  ? effortOptionsFromProvider(
                                      resolveProviderEfforts(
                                        provider,
                                        pick.modelId,
                                      ),
                                    ) ?? GROK_BUILD_EFFORTS
                                  : GROK_BUILD_EFFORTS;
                              })();
                        setForm((f) => ({
                          ...f,
                          providerId: nextProvider,
                          modelId: pick.modelId,
                          effort: nextEfforts.some((e) => e.id === f.effort)
                            ? f.effort
                            : (nextEfforts.find((e) => e.isDefault)?.id ??
                              nextEfforts[0]?.id ??
                              f.effort),
                        }));
                      }}
                      aria-label={t("automations.field.model")}
                    />
                  </div>
                  <div className="auto-field auto-field--row">
                    <span>{t("automations.field.effort")}</span>
                    <Select
                      value={form.effort}
                      options={effortOptions}
                      onChange={(v) => setForm((f) => ({ ...f, effort: v }))}
                      aria-label={t("automations.field.effort")}
                    />
                  </div>
                </>
              ) : (
                <>
                  <div className="auto-field auto-field--row">
                    <span>{t("automations.field.session")}</span>
                    <Select
                      value={form.sessionId}
                      options={sessionPickerOptions}
                      searchable
                      searchPlaceholder={t(
                        "automations.field.sessionSearchPh",
                      )}
                      emptyLabel={t("automations.sessionSearchNoResults")}
                      onChange={(v) => {
                        const picked = sessionOptions.find((s) => s.id === v);
                        setForm((f) => ({
                          ...f,
                          sessionId: v,
                          projectId: picked
                            ? (picked.projectId ?? "")
                            : f.projectId,
                        }));
                      }}
                      aria-label={t("automations.field.session")}
                    />
                  </div>
                  <p className="auto-field__hint">
                    {t("automations.sessionModelHint")}
                  </p>
                </>
              )}
            </div>

            <div className="auto-panel__section">
              <div className="auto-panel__section-label">
                {t("automations.section.schedule")}
              </div>
              <div className="auto-field auto-field--row">
                <span>{t("automations.field.frequency")}</span>
                <Select
                  value={form.frequency}
                  options={freqOptions}
                  onChange={(v) => setForm((f) => ({ ...f, frequency: v }))}
                  aria-label={t("automations.field.frequency")}
                />
              </div>
              <div className="auto-field auto-field--row">
                <span>{t("automations.field.time")}</span>
                <Select
                  value={form.time}
                  options={timeOptions}
                  onChange={(v) => setForm((f) => ({ ...f, time: v }))}
                  aria-label={t("automations.field.time")}
                />
              </div>
              <div className="auto-field auto-field--row">
                <span>{t("automations.field.notify")}</span>
                <Select
                  value={form.notify}
                  options={notifyOptions}
                  onChange={(v) => setForm((f) => ({ ...f, notify: v }))}
                  aria-label={t("automations.field.notify")}
                />
              </div>
            </div>
          </div>
          <div className="auto-panel__foot">
            <button type="button" className="btn btn--ghost" onClick={closePanel}>
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn--solid"
              onClick={() => void saveForm()}
            >
              {editingId ? t("automations.save") : t("automations.create")}
            </button>
          </div>
        </aside>
      )}
    </div>
  );
}
