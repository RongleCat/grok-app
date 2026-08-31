/**
 * Structured Doctor health UI — triage findings (classify / filter / copy /
 * redacted export), GlassModal detail, re-run, support zip, reset app data,
 * CLI doctor fixes.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  IconAlertTriangle,
  IconCheck,
  IconClose,
  IconCopy,
  IconDoctor,
  IconRefresh,
} from "@/components/icons";
import { GlassModal } from "@/components/GlassModal";
import { Select } from "@/components/Select";
import { createT, intlLocale, type Locale, type MessageKey } from "@/i18n";
import * as api from "@/lib/api";
import type { DoctorLevel, DoctorReport } from "@/lib/api";
import {
  CLI_DOCTOR_FACT_KEYS,
  extractFixIds,
  formatFactValue,
  hasAnySafeFact,
  listSafeAutoFixes,
  parseCliDoctorEnvelope,
  summarizeFixPlan,
  type CliDoctorSafeFacts,
  type CliDoctorView,
  type DoctorFixHandle,
} from "@/lib/cliDoctor";
import {
  buildDoctorFindingsExport,
  categoriesPresent,
  collectDoctorFindings,
  countDoctorFindings,
  doctorFindingCopyText,
  doctorFindingsExportIsEmpty,
  doctorFindingsExportJsonFilename,
  filterDoctorFindings,
  formatDoctorFindingsExportText,
  APP_AGENT_SIDECAR_SKEW_FINDING_ID,
  isAgentSidecarSkewFinding,
  presentDoctorFindingDetail,
  serializeDoctorFindingsExport,
  type DoctorFindingCategory,
  type DoctorFindingCategoryFilter,
  type DoctorFindingLevelFilter,
  type DoctorFindingRow,
  type DoctorFindingSourceFilter,
} from "@/lib/doctorFindings";
import { CliUpdateRow } from "@/components/CliUpdateRow";
import { detectAppPlatform } from "@/lib/appPlatform";
import {
  classifyCliVersionStatus,
  cliVersionStatusHintClass,
  cliVersionStatusMessageKey,
  cliVersionStatusMessageParams,
} from "@/lib/cliVersionStatus";
import { DEFAULT_SANDBOX_PROFILE } from "@/lib/sandboxProfile";
import {
  buildDoctorPlatformMatrix,
  doctorPlatformCellStatusKey,
  doctorPlatformCellTone,
} from "@/lib/doctorPlatformMatrix";
import { useUpdaterContext } from "@/hooks/UpdaterProvider";
import {
  buildSettingsHash,
  isSettingsSectionId,
  type SettingsSectionId,
  type SettingsTabId,
} from "@/lib/settingsCatalog";
import {
  WINDOWS_DAYUSE_DOCS_PATH,
  buildWindowsDayuseChecklist,
  deriveProjectSpacesProbe,
  formatWindowsDayuseSummaryText,
  resolveWindowsDayuseEmptyState,
  windowsDayusePlatformBadgeKey,
  windowsDayuseStatusKey,
  windowsDayuseStatusTone,
  type WindowsDayuseLinkTarget,
} from "@/lib/windowsDayuseChecklist";
import {
  LINUX_DAYUSE_DOCS_PATH,
  buildLinuxDayuseChecklist,
  formatLinuxDayuseSummaryText,
  resolveLinuxDayuseEmptyState,
  linuxDayusePlatformBadgeKey,
  linuxDayuseStatusKey,
  linuxDayuseStatusTone,
  type LinuxDayuseLinkTarget,
} from "@/lib/linuxDayuseChecklist";
import { redact } from "@/lib/redact";
import {
  canSupportBundleExport,
  formatSupportBundleManifest,
  planSupportBundleExport,
  resolveSupportBundleEmptyState,
  resolveSupportBundleSoftFail,
  type SupportBundleExportPlan,
} from "@/lib/supportBundlePro";

/** Client download for redacted findings JSON (no host round-trip). */
function downloadDoctorFindingsJson(filename: string, body: string) {
  const blob = new Blob([body], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export type DoctorModalProps = {
  open: boolean;
  onClose: () => void;
  locale: Locale;
  /**
   * App-level confirm dialog (no window.confirm).
   * Used for the two-step reset flow.
   */
  onConfirm?: (opts: {
    title: string;
    message: string;
    confirmLabel?: string;
    danger?: boolean;
    onConfirm: () => void;
  }) => void;
  /** After a successful reset — reload lists / hard refresh. */
  onResetDone?: () => void;
  /** Open Reliability / Observability center (busy · stalls · errors). */
  onOpenReliability?: () => void;
  /**
   * Effective sandbox profile for platform-matrix honesty
   * (global or project-resolved). Optional — omit → treat as off / default.
   */
  sandboxProfile?: string | null;
  /**
   * Open Settings at section/tab (day-use checklist deep links).
   * When omitted, falls back to `location.hash` via `buildSettingsHash`.
   */
  onOpenSettings?: (section: string, tab?: string | null) => void;
};

const CHECK_TITLE_KEYS: Record<string, MessageKey> = {
  cli: "doctor.check.cli",
  auth: "doctor.check.auth",
  workspace: "doctor.check.workspace",
  backend: "doctor.check.backend",
  logs: "doctor.check.logs",
};

const CATEGORY_LABEL_KEYS: Record<DoctorFindingCategory, MessageKey> = {
  cli: "doctor.category.cli",
  auth: "doctor.category.auth",
  workspace: "doctor.category.workspace",
  backend: "doctor.category.backend",
  logs: "doctor.category.logs",
  terminal: "doctor.category.terminal",
  clipboard: "doctor.category.clipboard",
  color: "doctor.category.color",
  multiplexer: "doctor.category.multiplexer",
  ssh: "doctor.category.ssh",
  voice: "doctor.category.voice",
  other: "doctor.category.other",
};

function levelLabelKey(level: DoctorLevel): MessageKey {
  if (level === "warn") return "doctor.level.warn";
  if (level === "fail") return "doctor.level.fail";
  return "doctor.level.ok";
}

function findingTitle(row: DoctorFindingRow, t: ReturnType<typeof createT>): string {
  if (row.source === "app") {
    const key = CHECK_TITLE_KEYS[row.rawId];
    if (key) return t(key);
  }
  if (row.rawId === "cli-doctor-clean") return t("doctor.cliDoctorEmpty");
  return row.title;
}

function formatGeneratedAt(iso: string, locale: Locale): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(intlLocale(locale), {
      dateStyle: "medium",
      timeStyle: "medium",
    });
  } catch {
    return iso;
  }
}

function LevelIcon({ level }: { level: DoctorLevel }) {
  if (level === "fail") {
    return <IconClose size={14} className="doctor-check__icon" />;
  }
  if (level === "warn") {
    return <IconAlertTriangle size={14} className="doctor-check__icon" />;
  }
  return <IconCheck size={14} className="doctor-check__icon" />;
}

const FACT_LABEL_KEYS: Record<
  (typeof CLI_DOCTOR_FACT_KEYS)[number],
  MessageKey
> = {
  terminal: "doctor.cliDoctorFact.terminal",
  clipboard: "doctor.cliDoctorFact.clipboard",
  color: "doctor.cliDoctorFact.color",
  multiplexer: "doctor.cliDoctorFact.multiplexer",
  ssh: "doctor.cliDoctorFact.ssh",
  voice: "doctor.cliDoctorFact.voice",
};

function factEntries(
  facts: CliDoctorSafeFacts,
): Array<{ key: (typeof CLI_DOCTOR_FACT_KEYS)[number]; value: string }> {
  const out: Array<{
    key: (typeof CLI_DOCTOR_FACT_KEYS)[number];
    value: string;
  }> = [];
  for (const key of CLI_DOCTOR_FACT_KEYS) {
    const raw = facts[key];
    if (raw === undefined || raw === null || raw === "") continue;
    out.push({ key, value: formatFactValue(key, raw) });
  }
  return out;
}

export function DoctorModal({
  open,
  onClose,
  locale,
  onConfirm,
  onResetDone,
  onOpenReliability,
  onOpenSettings,
  sandboxProfile = DEFAULT_SANDBOX_PROFILE,
}: DoctorModalProps) {
  // Product tree wraps Doctor in UpdaterProvider (App shell).
  const { channelInfo } = useUpdaterContext();

  const t = useMemo(() => createT(locale), [locale]);
  const [report, setReport] = useState<DoctorReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedFindingKey, setCopiedFindingKey] = useState<string | null>(null);
  const [busy, setBusy] = useState<
    | "zip"
    | "reset"
    | "fix"
    | "findings-export"
    | "dayuse-copy"
    | "agent-skew-repair"
    | null
  >(null);
  /** Extra probes for Windows day-use card (projects / mirror / updater). */
  const [dayuseProbe, setDayuseProbe] = useState<{
    hasTrustedProject: boolean | null;
    pathHasSpaces: boolean | null;
    mirrorWriteEnabled: boolean | null;
    sandboxProfile: string | null;
    updateSupported: boolean | null;
  }>({
    hasTrustedProject: null,
    pathHasSpaces: null,
    mirrorWriteEnabled: null,
    sandboxProfile: null,
    updateSupported: null,
  });
  /** Which fix id is currently running (for per-row spinner). */
  const [fixingId, setFixingId] = useState<string | null>(null);
  const [keepSecrets, setKeepSecrets] = useState(true);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [confirmSupportZip, setConfirmSupportZip] = useState(false);

  // Triage filters
  const [levelFilter, setLevelFilter] =
    useState<DoctorFindingLevelFilter>("all");
  const [categoryFilter, setCategoryFilter] =
    useState<DoctorFindingCategoryFilter>("all");
  const [sourceFilter, setSourceFilter] =
    useState<DoctorFindingSourceFilter>("all");
  const [query, setQuery] = useState("");
  const [issuesOnly, setIssuesOnly] = useState(false);
  const [detailKey, setDetailKey] = useState<string | null>(null);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    setCopied(false);
    setStatusMsg(null);
    try {
      const next = await api.doctorReport();
      setReport(next);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void run();
  }, [open, run]);

  /** Soft-probe projects / mirror / updater for Windows day-use checklist. */
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      let hasTrustedProject: boolean | null = null;
      let pathHasSpaces: boolean | null = null;
      let mirrorWriteEnabled: boolean | null = null;
      let updateSupported: boolean | null = null;
      try {
        const projects = await api.projectsList();
        const derived = deriveProjectSpacesProbe(projects);
        hasTrustedProject = derived.hasTrustedProject;
        pathHasSpaces = derived.pathHasSpaces;
      } catch {
        /* leave null → manual */
      }
      try {
        const st = await api.mirrorStatus();
        // Product default is read-only; missing readOnly ⇒ treat as RO (pass).
        mirrorWriteEnabled = st.readOnly === false;
      } catch {
        /* leave null → manual */
      }
      try {
        const up = await api.updaterStatus();
        // GitHub manual or silent plugin both count as "can check".
        updateSupported =
          up.platformSupported === true ||
          up.pluginEnabled === true ||
          up.channel === "github_manual" ||
          up.channel === "silent";
      } catch {
        try {
          updateSupported = await api.isAutoUpdateSupported();
        } catch {
          /* leave null → manual */
        }
      }
      if (!cancelled) {
        setDayuseProbe({
          hasTrustedProject,
          pathHasSpaces,
          mirrorWriteEnabled,
          sandboxProfile: typeof sandboxProfile === "string" ? sandboxProfile : null,
          updateSupported,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      // Don't close the main modal when detail GlassModal is open (it traps Escape).
      if (e.key === "Escape" && !detailKey) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose, detailKey]);

  // Reset triage UI when modal closes.
  useEffect(() => {
    if (open) return;
    setLevelFilter("all");
    setCategoryFilter("all");
    setSourceFilter("all");
    setQuery("");
    setIssuesOnly(false);
    setDetailKey(null);
    setCopiedFindingKey(null);
    setConfirmSupportZip(false);
    setDayuseProbe({
      hasTrustedProject: null,
      pathHasSpaces: null,
      mirrorWriteEnabled: null,
      sandboxProfile: null,
        updateSupported: null,
    });
  }, [open]);

  const onCopyReport = async () => {
    if (!report) return;
    const payload = report.raw ?? report;
    const text = redact(JSON.stringify(payload, null, 2));
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setError(t("doctor.error"));
    }
  };

  /** Honest support-zip plan — never invents stall/logs/secrets. */
  const supportPlan: SupportBundleExportPlan = useMemo(
    () =>
      planSupportBundleExport({
        // Host always writes doctor.json (uses live report when present).
        hasDoctor: true,
        // Doctor path does not attach Reliability stall timeline.
        hasStallTimeline: false,
        isHost: api.isTauri(),
      }),
    [],
  );

  const supportManifestText = useMemo(
    () => formatSupportBundleManifest(supportPlan),
    [supportPlan],
  );

  const supportEmpty = useMemo(
    () =>
      resolveSupportBundleEmptyState({
        isHost: api.isTauri(),
        hasDoctor: supportPlan.hasDoctor,
      }),
    [supportPlan],
  );

  const onSupportZipRequest = () => {
    setStatusMsg(null);
    setError(null);
    if (supportEmpty) {
      setError(
        `${t(supportEmpty.titleKey as MessageKey)}. ${t(supportEmpty.hintKey as MessageKey)}`,
      );
      return;
    }
    if (
      !canSupportBundleExport({
        isHost: api.isTauri(),
        busy: !!busy || loading,
      })
    ) {
      return;
    }
    setConfirmSupportZip(true);
  };

  const doSupportZip = async () => {
    setConfirmSupportZip(false);
    setBusy("zip");
    setStatusMsg(null);
    setError(null);
    try {
      const payload = report
        ? JSON.stringify(report.raw ?? report, null, 2)
        : null;
      const res = await api.exportSupportBundle(payload);
      setStatusMsg(`${t("doctor.supportZipDone")}: ${res.path}`);
    } catch (e) {
      const soft = resolveSupportBundleSoftFail(e);
      if (soft.silent) return;
      const base = t(soft.messageKey as MessageKey);
      setError(soft.detail ? `${base}: ${soft.detail}` : base);
    } finally {
      setBusy(null);
    }
  };

  const doReset = async () => {
    setBusy("reset");
    setError(null);
    try {
      await api.resetAppData(keepSecrets);
      setStatusMsg(t("doctor.resetDone"));
      onResetDone?.();
      // Hard reload so in-memory session/project state is dropped.
      window.setTimeout(() => {
        window.location.reload();
      }, 600);
    } catch (e) {
      setError(`${t("doctor.resetFail")}: ${String(e)}`);
      setBusy(null);
    }
  };

  const onResetClick = () => {
    const start = () => {
      if (onConfirm) {
        onConfirm({
          title: t("doctor.resetConfirmTitle"),
          message: t("doctor.resetConfirmBody"),
          confirmLabel: t("doctor.reset"),
          danger: true,
          onConfirm: () => {
            onConfirm({
              title: t("doctor.resetConfirm2Title"),
              message: t("doctor.resetConfirm2Body"),
              confirmLabel: t("common.confirm"),
              danger: true,
              onConfirm: () => {
                void doReset();
              },
            });
          },
        });
      } else {
        // Fallback for isolated stories — still no window.confirm.
        void doReset();
      }
    };
    start();
  };

  const cliDoctor: CliDoctorView | null = useMemo(() => {
    if (!report) return null;
    return parseCliDoctorEnvelope(report.cliDoctor ?? null);
  }, [report]);

  /** Fix handles from CLI findings (automaticRemediation / fixId). */
  const cliFixes: DoctorFixHandle[] = useMemo(() => {
    if (!report?.cliDoctor) return [];
    return extractFixIds(report.cliDoctor);
  }, [report]);

  const fixPlan = useMemo(
    () => summarizeFixPlan(cliDoctor),
    [cliDoctor],
  );

  const safeAutoFixes = useMemo(
    () => listSafeAutoFixes(cliDoctor),
    [cliDoctor],
  );

  const allFindings = useMemo(
    () => collectDoctorFindings(report?.checks ?? [], cliDoctor),
    [report, cliDoctor],
  );

  const visibleFindings = useMemo(
    () =>
      filterDoctorFindings(allFindings, {
        level: levelFilter,
        category: categoryFilter,
        source: sourceFilter,
        query,
        issuesOnly,
      }),
    [
      allFindings,
      levelFilter,
      categoryFilter,
      sourceFilter,
      query,
      issuesOnly,
    ],
  );

  const findingCounts = useMemo(
    () => countDoctorFindings(allFindings),
    [allFindings],
  );

  const presentCategories = useMemo(
    () => categoriesPresent(allFindings),
    [allFindings],
  );

  const hasActiveFilters =
    levelFilter !== "all" ||
    categoryFilter !== "all" ||
    sourceFilter !== "all" ||
    issuesOnly ||
    query.trim().length > 0;

  const detailRow = useMemo(
    () => allFindings.find((r) => r.key === detailKey) ?? null,
    [allFindings, detailKey],
  );
  const detailPresentation = useMemo(
    () => presentDoctorFindingDetail(detailRow),
    [detailRow],
  );

  /** Host/stdout/stderr detail for a failed fix (no fix id prefix). */
  const fixHostDetail = useCallback(
    (res: api.CliDoctorFixResult | null, caught?: unknown) => {
      if (caught != null) return redact(String(caught)).slice(0, 320);
      return redact(
        (
          res?.error ||
          res?.stderr ||
          res?.stdout ||
          t("doctor.cliDoctorFixFail")
        ).trim(),
      ).slice(0, 320);
    },
    [t],
  );

  const formatFixHostError = useCallback(
    (fixId: string, res: api.CliDoctorFixResult | null, caught?: unknown) => {
      return t("doctor.cliDoctorFixFailWithId", {
        id: fixId,
        error: fixHostDetail(res, caught),
      });
    },
    [fixHostDetail, t],
  );

  /** One-click: align ~/.grok/bin/agent with grok (App-managed, not CLI doctor fix). */
  const repairAgentSidecarSkew = useCallback(async () => {
    setBusy("agent-skew-repair");
    setFixingId(APP_AGENT_SIDECAR_SKEW_FINDING_ID);
    setError(null);
    setStatusMsg(null);
    try {
      const res = await api.cliRepairAgentSidecar();
      await run();
      if (res.ok && !res.agentBinarySkew) {
        setStatusMsg(
          t("doctor.agentSkewRepaired", {
            agentVersion: res.agentVersion || res.grokVersion || "—",
          }),
        );
      } else if (res.ok) {
        setStatusMsg(
          t("doctor.agentSkewStillSkewed", {
            agentVersion: res.agentVersion || "—",
            grokVersion: res.grokVersion || "—",
          }),
        );
      } else {
        setError(t("doctor.agentSkewRepairFailed", { error: "unknown" }));
      }
    } catch (e) {
      setError(
        t("doctor.agentSkewRepairFailed", {
          error: redact(String(e)).slice(0, 240),
        }),
      );
    } finally {
      setBusy(null);
      setFixingId(null);
    }
  }, [run, t]);

  const applyFix = useCallback(
    async (fixId: string) => {
      setBusy("fix");
      setFixingId(fixId);
      setError(null);
      setStatusMsg(null);
      try {
        const res = await api.cliDoctorFix(fixId);
        // Re-run doctor so findings refresh; then restore fix outcome
        // (run() clears status/error at start).
        await run();
        if (res.ok) {
          const preview = (res.stdout || res.stderr || "").trim();
          setStatusMsg(
            preview
              ? t("doctor.cliDoctorFixDoneDetail", {
                  id: fixId,
                  detail: redact(preview).slice(0, 240),
                })
              : t("doctor.cliDoctorFixDone", { id: fixId }),
          );
        } else {
          setError(formatFixHostError(fixId, res));
        }
      } catch (e) {
        setError(formatFixHostError(fixId, null, e));
      } finally {
        setBusy(null);
        setFixingId(null);
      }
    },
    [formatFixHostError, run, t],
  );

  /**
   * Run all non-destructive fixIds sequentially via the host path,
   * then re-run doctor once. Stops on first failure.
   */
  const applySafeFixes = useCallback(async () => {
    const safe = listSafeAutoFixes(cliDoctor);
    if (safe.length === 0) return;

    setBusy("fix");
    setError(null);
    setStatusMsg(null);

    const applied: string[] = [];
    let failedId: string | null = null;
    let failedMsg: string | null = null;
    let lastFixId: string | null = null;

    try {
      for (let i = 0; i < safe.length; i += 1) {
        const fixId = safe[i].fixId;
        if (!fixId) continue;
        lastFixId = fixId;
        setFixingId(fixId);
        setStatusMsg(
          t("doctor.cliDoctorFixBatchProgress", {
            current: i + 1,
            total: safe.length,
            id: fixId,
          }),
        );
        try {
          const res = await api.cliDoctorFix(fixId);
          if (res.ok) {
            applied.push(fixId);
          } else {
            failedId = fixId;
            failedMsg = fixHostDetail(res);
            break;
          }
        } catch (e) {
          failedId = fixId;
          failedMsg = fixHostDetail(null, e);
          break;
        }
      }

      // Refresh findings after the batch (success or partial).
      await run();

      if (failedId && failedMsg) {
        setError(
          applied.length > 0
            ? t("doctor.cliDoctorFixBatchPartial", {
                ok: applied.length,
                id: failedId,
                error: failedMsg,
              })
            : t("doctor.cliDoctorFixFailWithId", {
                id: failedId,
                error: failedMsg,
              }),
        );
      } else {
        setStatusMsg(
          t("doctor.cliDoctorFixBatchDone", { count: applied.length }),
        );
      }
    } catch (e) {
      setError(
        t("doctor.cliDoctorFixFailWithId", {
          id: lastFixId || "batch",
          error: redact(String(e)).slice(0, 320),
        }),
      );
    } finally {
      setBusy(null);
      setFixingId(null);
    }
  }, [cliDoctor, fixHostDetail, run, t]);

  const onApplyFix = useCallback(
    (handle: { fixId: string; message?: string; destructive?: boolean }) => {
      const runFix = () => {
        void applyFix(handle.fixId);
      };
      // Destructive (shell/config) fixes always go through in-app confirm.
      if (handle.destructive !== false && onConfirm) {
        onConfirm({
          title: t("doctor.cliDoctorFixConfirmTitle"),
          message: t("doctor.cliDoctorFixConfirmBody", {
            id: handle.fixId,
            message: handle.message?.trim() || handle.fixId,
          }),
          confirmLabel: t("doctor.cliDoctorFix"),
          danger: true,
          onConfirm: runFix,
        });
        return;
      }
      runFix();
    },
    [applyFix, onConfirm, t],
  );

  const fixHandleForRow = useCallback(
    (row: DoctorFindingRow): DoctorFixHandle | null => {
      if (row.fixId) {
        return {
          fixId: row.fixId,
          findingId: row.rawId,
          message: row.title,
          destructive: row.destructive !== false,
        };
      }
      return (
        cliFixes.find(
          (f) => f.findingId === row.rawId || f.fixId === row.rawId,
        ) ?? null
      );
    },
    [cliFixes],
  );

  const copyFinding = useCallback(
    async (row: DoctorFindingRow) => {
      const text = doctorFindingCopyText(row);
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
        setCopiedFindingKey(row.key);
        setStatusMsg(t("doctor.finding.copied"));
        window.setTimeout(() => {
          setCopiedFindingKey((cur) => (cur === row.key ? null : cur));
          setStatusMsg((cur) =>
            cur === t("doctor.finding.copied") ? null : cur,
          );
        }, 1600);
      } catch {
        setError(t("doctor.error"));
      }
    },
    [t],
  );

  const findingsExportFilter = useMemo(
    () => ({
      level: levelFilter,
      category: categoryFilter,
      source: sourceFilter,
      query,
      issuesOnly,
    }),
    [levelFilter, categoryFilter, sourceFilter, query, issuesOnly],
  );

  /** Redacted export snapshot for the currently visible (filtered) set. */
  const visibleFindingsExport = useMemo(
    () =>
      buildDoctorFindingsExport(visibleFindings, {
        filter: findingsExportFilter,
      }),
    [visibleFindings, findingsExportFilter],
  );

  const copyVisibleFindings = useCallback(async () => {
    if (doctorFindingsExportIsEmpty(visibleFindingsExport)) {
      setStatusMsg(null);
      setError(t("doctor.finding.exportEmpty"));
      return;
    }
    const text = formatDoctorFindingsExportText(visibleFindingsExport);
    if (!text) {
      setError(t("doctor.finding.exportEmpty"));
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setError(null);
      setStatusMsg(
        t("doctor.finding.copiedN", {
          count: visibleFindingsExport.count,
        }),
      );
      window.setTimeout(() => setStatusMsg(null), 1600);
    } catch {
      setError(t("doctor.finding.exportFail"));
    }
  }, [t, visibleFindingsExport]);

  const onExportFindings = useCallback(() => {
    setBusy("findings-export");
    setStatusMsg(null);
    setError(null);
    try {
      if (doctorFindingsExportIsEmpty(visibleFindingsExport)) {
        setError(t("doctor.finding.exportEmpty"));
        return;
      }
      const body = serializeDoctorFindingsExport(visibleFindingsExport);
      const filename = doctorFindingsExportJsonFilename(
        visibleFindingsExport.generatedAt,
      );
      downloadDoctorFindingsJson(filename, body);
      setStatusMsg(
        t("doctor.finding.exportDone", {
          count: visibleFindingsExport.count,
        }),
      );
    } catch (e) {
      setError(`${t("doctor.finding.exportFail")}: ${String(e)}`);
    } finally {
      setBusy(null);
    }
  }, [t, visibleFindingsExport]);

  const clearFilters = useCallback(() => {
    setLevelFilter("all");
    setCategoryFilter("all");
    setSourceFilter("all");
    setQuery("");
    setIssuesOnly(false);
  }, []);

  /** App-resolved CLI path/version/source (probe), separate from `grok doctor` JSON. */
  // Hooks must run unconditionally — do not place below `if (!open) return null`
  // or opening Doctor throws "Rendered more hooks than during the previous render"
  // and white-screens the whole app (DoctorModal sits outside UiErrorBoundary).
  const cliResolved = useMemo(() => {
    const raw = report?.raw as
      | {
          cli?: {
            found?: boolean;
            path?: string | null;
            version?: string | null;
            source?: string | null;
            minVersion?: string | null;
            recommendedVersion?: string | null;
            meetsRecommended?: boolean | null;
            versionSupported?: boolean | null;
            agentVersion?: string | null;
            agentBinarySkew?: boolean;
            acpAgentVersion?: string | null;
            acpAgentVersionSkew?: boolean;
          };
        }
      | undefined;
    const cli = raw?.cli;
    if (!cli) return null;
    const trimOrNull = (v: unknown) =>
      typeof v === "string" && v.trim() ? v.trim() : null;
    return {
      found: !!cli.found,
      path: trimOrNull(cli.path),
      version: trimOrNull(cli.version),
      source: trimOrNull(cli.source),
      minVersion: trimOrNull(cli.minVersion),
      recommendedVersion: trimOrNull(cli.recommendedVersion),
      meetsRecommended:
        typeof cli.meetsRecommended === "boolean"
          ? cli.meetsRecommended
          : null,
      versionSupported:
        typeof cli.versionSupported === "boolean"
          ? cli.versionSupported
          : null,
      agentVersion: trimOrNull(cli.agentVersion),
      agentBinarySkew: !!cli.agentBinarySkew,
      acpAgentVersion: trimOrNull(cli.acpAgentVersion),
      acpAgentVersionSkew: !!cli.acpAgentVersionSkew,
    };
  }, [report]);

  const platform = useMemo(() => detectAppPlatform(), []);

  const windowsDayuseEmpty = useMemo(
    () => resolveWindowsDayuseEmptyState({ platform }),
    [platform],
  );

  const windowsDayuseChecklist = useMemo(() => {
    // Prefer Doctor report CLI probe; fall back to unresolved → manual.
    let cliFound: boolean | null = null;
    if (cliResolved) {
      cliFound = cliResolved.found;
    } else if (report?.checks) {
      const cliCheck = report.checks.find((c) => c.id === "cli");
      if (cliCheck) {
        cliFound = cliCheck.level !== "fail";
      }
    }
    return buildWindowsDayuseChecklist({
      platform,
      cliFound,
      hasTrustedProject: dayuseProbe.hasTrustedProject,
      pathHasSpaces: dayuseProbe.pathHasSpaces,
      mirrorWriteEnabled: dayuseProbe.mirrorWriteEnabled,
      updateSupported: dayuseProbe.updateSupported,
      // Never invent SmartScreen — leave smartScreenProbed unset.
    });
  }, [platform, cliResolved, report, dayuseProbe]);

  /**
   * Platform capability matrix — pure honesty from known inputs only.
   * Never invents CLI found / update channel / media probe results.
   */
  const platformMatrix = useMemo(() => {
    const cliFound =
      cliResolved != null
        ? cliResolved.found
        : report?.checks?.find((c) => c.id === "cli")
          ? report.checks.find((c) => c.id === "cli")!.level !== "fail"
          : null;
    return buildDoctorPlatformMatrix({
      platform: detectAppPlatform(),
      cliFound,
      sandboxProfile,
      updateChannel: channelInfo?.channel ?? null,
      // Omit live media probe — design honesty only (no invented uptime).
    });
  }, [channelInfo?.channel, cliResolved, report, sandboxProfile]);

  const copyCliPath = useCallback(
    async (path: string) => {
      try {
        await navigator.clipboard.writeText(path);
        setStatusMsg(t("doctor.pathCopied"));
        window.setTimeout(() => setStatusMsg(null), 1600);
      } catch {
        setError(t("doctor.error"));
      }
    },
    [t],
  );

  const onCopyWindowsDayuse = useCallback(async () => {
    setBusy("dayuse-copy");
    setStatusMsg(null);
    setError(null);
    try {
      const text = formatWindowsDayuseSummaryText(windowsDayuseChecklist, {
        title: t("doctor.windowsDayuse.title"),
        generatedAt: new Date().toISOString(),
      });
      await navigator.clipboard.writeText(text);
      setStatusMsg(t("doctor.windowsDayuse.copied"));
      window.setTimeout(() => setStatusMsg(null), 1600);
    } catch {
      setError(t("doctor.windowsDayuse.copyFail"));
    } finally {
      setBusy(null);
    }
  }, [t, windowsDayuseChecklist]);


  const linuxDayuseEmpty = useMemo(
    () => resolveLinuxDayuseEmptyState({ platform }),
    [platform],
  );

  const linuxDayuseChecklist = useMemo(() => {
    // Prefer Doctor report CLI probe; fall back to unresolved → manual.
    let cliFound: boolean | null = null;
    if (cliResolved) {
      cliFound = cliResolved.found;
    } else if (report?.checks) {
      const cliCheck = report.checks.find((c) => c.id === "cli");
      if (cliCheck) {
        cliFound = cliCheck.level !== "fail";
      }
    }
    return buildLinuxDayuseChecklist({
      platform,
      cliFound,
      hasTrustedProject: dayuseProbe.hasTrustedProject,
      pathHasSpaces: dayuseProbe.pathHasSpaces,
      sandboxProfile: dayuseProbe.sandboxProfile,
      updateSupported: dayuseProbe.updateSupported,
      // Never invent Landlock / tray / Wayland·X11 probes.
    });
  }, [platform, cliResolved, report, dayuseProbe]);

  const onCopyLinuxDayuse = useCallback(async () => {
    setBusy("dayuse-copy");
    setStatusMsg(null);
    setError(null);
    try {
      const text = formatLinuxDayuseSummaryText(linuxDayuseChecklist, {
        title: t("doctor.linuxDayuse.title"),
        generatedAt: new Date().toISOString(),
      });
      await navigator.clipboard.writeText(text);
      setStatusMsg(t("doctor.linuxDayuse.copied"));
      window.setTimeout(() => setStatusMsg(null), 1600);
    } catch {
      setError(t("doctor.linuxDayuse.copyFail"));
    } finally {
      setBusy(null);
    }
  }, [t, linuxDayuseChecklist]);


  const openDayuseLink = useCallback(
    (link: WindowsDayuseLinkTarget | LinuxDayuseLinkTarget) => {
      if (!link) return;
      let section: SettingsSectionId = "about";
      let tab: SettingsTabId | null = null;
      if (link === "about") {
        section = "about";
        tab = null;
      } else if (link === "mirror") {
        section = "remote_im";
        tab = "mirror";
      } else if (link === "setup" || link === "runtime") {
        section = "runtime";
        tab = "cli";
      }
      if (onOpenSettings) {
        onClose();
        onOpenSettings(section, tab);
        return;
      }
      // Hash deep-link fallback (no window.confirm).
      if (typeof window !== "undefined" && isSettingsSectionId(section)) {
        const hash = buildSettingsHash({ section, tab });
        onClose();
        if (window.location.hash !== hash) {
          window.location.hash = hash;
        }
      }
    },
    [onClose, onOpenSettings],
  );

  if (!open) return null;

  const cliFacts = cliDoctor ? factEntries(cliDoctor.facts) : [];

  const toggleLevel = (level: DoctorFindingLevelFilter) => {
    setLevelFilter((cur) => (cur === level ? "all" : level));
  };

  return (
    <div
      className="overlay doctor-modal-overlay"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="modal doctor-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="doctor-modal-title"
      >
        <header className="doctor-modal__head">
          <div className="doctor-modal__title-row">
            <IconDoctor size={18} />
            <h2 id="doctor-modal-title">{t("doctor.title")}</h2>
          </div>
          <button
            type="button"
            className="icon-btn modal-close doctor-modal__close"
            onClick={onClose}
            aria-label={t("doctor.close")}
          >
            <IconClose size={16} />
          </button>
        </header>

        {allFindings.length > 0 && !loading && (
          <div className="doctor-modal__summary" aria-live="polite">
            <button
              type="button"
              className={`doctor-summary-pill doctor-summary-pill--ok${
                findingCounts.ok ? " is-active" : ""
              }${levelFilter === "ok" ? " is-selected" : ""}`}
              onClick={() => toggleLevel("ok")}
              aria-pressed={levelFilter === "ok"}
              title={t("doctor.filter.levelOk")}
            >
              {findingCounts.ok} {t("doctor.level.ok")}
            </button>
            <button
              type="button"
              className={`doctor-summary-pill doctor-summary-pill--warn${
                findingCounts.warn ? " is-active" : ""
              }${levelFilter === "warn" ? " is-selected" : ""}`}
              onClick={() => toggleLevel("warn")}
              aria-pressed={levelFilter === "warn"}
              title={t("doctor.filter.levelWarn")}
            >
              {findingCounts.warn} {t("doctor.level.warn")}
            </button>
            <button
              type="button"
              className={`doctor-summary-pill doctor-summary-pill--fail${
                findingCounts.fail ? " is-active" : ""
              }${levelFilter === "fail" ? " is-selected" : ""}`}
              onClick={() => toggleLevel("fail")}
              aria-pressed={levelFilter === "fail"}
              title={t("doctor.filter.levelFail")}
            >
              {findingCounts.fail} {t("doctor.level.fail")}
            </button>
            {report?.generatedAt && (
              <span className="doctor-modal__ts">
                {t("doctor.generatedAt", {
                  time: formatGeneratedAt(report.generatedAt, locale),
                })}
              </span>
            )}
          </div>
        )}

        <div className="doctor-modal__body">
          {loading && (
            <p className="doctor-modal__status">{t("doctor.loading")}</p>
          )}
          {!loading && error && (
            <p className="doctor-modal__status doctor-modal__status--error">
              {t("doctor.error")}: {error}
            </p>
          )}
          {!loading && statusMsg && (
            <p className="doctor-modal__status" role="status">
              {statusMsg}
            </p>
          )}
          {!loading && cliResolved && (
            <div className="doctor-cli-resolved" aria-label={t("doctor.cliResolved")}>
              <div className="doctor-cli-resolved__head">
                <h3 className="doctor-cli-resolved__title">
                  {t("doctor.cliResolved")}
                </h3>
                {cliResolved.path ? (
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => void copyCliPath(cliResolved.path!)}
                  >
                    <IconCopy size={14} />
                    {t("doctor.copyPath")}
                  </button>
                ) : null}
              </div>
              <dl className="doctor-cli-resolved__grid">
                <div>
                  <dt>{t("doctor.cliPath")}</dt>
                  <dd className="doctor-cli-resolved__mono">
                    {cliResolved.path || t("doctor.cliPathMissing")}
                  </dd>
                </div>
                <div>
                  <dt>{t("doctor.cliVersion")}</dt>
                  <dd>{cliResolved.version || "—"}</dd>
                </div>
                <div>
                  <dt>{t("doctor.cliSource")}</dt>
                  <dd>{cliResolved.source || "—"}</dd>
                </div>
                <div>
                  <dt>{t("doctor.cliFound")}</dt>
                  <dd>
                    {cliResolved.found
                      ? t("doctor.level.ok")
                      : t("doctor.level.fail")}
                  </dd>
                </div>
                {cliResolved.agentVersion || cliResolved.agentBinarySkew ? (
                  <div>
                    <dt>{t("doctor.cliAgentSidecar")}</dt>
                    <dd>
                      {cliResolved.agentVersion || "—"}
                      {cliResolved.agentBinarySkew
                        ? ` · ${t("doctor.cliAgentSidecarSkew")}`
                        : ""}
                    </dd>
                  </div>
                ) : null}
                {cliResolved.acpAgentVersion ||
                cliResolved.acpAgentVersionSkew ? (
                  <div>
                    <dt>{t("doctor.cliAcpAgentVersion")}</dt>
                    <dd>
                      {cliResolved.acpAgentVersion || "—"}
                      {cliResolved.acpAgentVersionSkew
                        ? ` · ${t("doctor.cliAcpAgentVersionSkew")}`
                        : ""}
                    </dd>
                  </div>
                ) : null}
              </dl>
              {(() => {
                const status = classifyCliVersionStatus(cliResolved);
                const tone = cliVersionStatusHintClass(status);
                return (
                  <div
                    className={
                      "settings-row__hint doctor-cli-resolved__recommend" +
                      (tone ? ` ${tone}` : "")
                    }
                    data-testid="doctor-cli-version-status"
                    data-status={status}
                  >
                    {t(
                      cliVersionStatusMessageKey(status),
                      cliVersionStatusMessageParams(cliResolved),
                    )}
                  </div>
                );
              })()}
            </div>
          )}

          {!loading && allFindings.length === 0 && (
            <p className="doctor-modal__status">{t("doctor.empty")}</p>
          )}

          {!loading && allFindings.length > 0 && (
            <section
              className="doctor-findings"
              aria-label={t("doctor.findings.title")}
            >
              <div className="doctor-findings__head">
                <h3 className="doctor-findings__title">
                  {t("doctor.findings.title")}
                </h3>
                <p className="doctor-findings__hint">
                  {t("doctor.findings.hint", {
                    shown: visibleFindings.length,
                    total: allFindings.length,
                  })}
                </p>
              </div>

              <div className="doctor-findings__toolbar">
                <input
                  type="search"
                  className="settings-input doctor-findings__search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("doctor.filter.searchPlaceholder")}
                  autoComplete="off"
                  spellCheck={false}
                  aria-label={t("doctor.filter.searchPlaceholder")}
                />
                <div
                  className="doctor-findings__chips"
                  role="group"
                  aria-label={t("doctor.filter.sourceAria")}
                >
                  {(
                    [
                      ["all", "doctor.filter.sourceAll"],
                      ["app", "doctor.filter.sourceApp"],
                      ["cli", "doctor.filter.sourceCli"],
                    ] as const
                  ).map(([id, key]) => (
                    <button
                      key={id}
                      type="button"
                      className={
                        "doctor-findings__chip" +
                        (sourceFilter === id ? " is-active" : "")
                      }
                      aria-pressed={sourceFilter === id}
                      onClick={() => setSourceFilter(id)}
                    >
                      {t(key)}
                      {id !== "all" ? (
                        <span className="doctor-findings__chip-n">
                          {id === "app"
                            ? findingCounts.bySource.app
                            : findingCounts.bySource.cli}
                        </span>
                      ) : null}
                    </button>
                  ))}
                </div>
                <div className="doctor-findings__category">
                  <Select
                    value={categoryFilter}
                    options={[
                      { value: "all", label: t("doctor.filter.categoryAll") },
                      ...presentCategories.map((c) => ({
                        value: c,
                        label:
                          t(CATEGORY_LABEL_KEYS[c]) +
                          (findingCounts.byCategory[c]
                            ? ` (${findingCounts.byCategory[c]})`
                            : ""),
                      })),
                    ]}
                    onChange={(v) => setCategoryFilter(v as DoctorFindingCategoryFilter)}
                    aria-label={t("doctor.filter.categoryAria")}
                    className="doctor-findings__select"
                  />
                </div>
                <label className="doctor-findings__issues">
                  <input
                    type="checkbox"
                    checked={issuesOnly}
                    onChange={(e) => setIssuesOnly(e.target.checked)}
                  />
                  <span>{t("doctor.filter.issuesOnly")}</span>
                </label>
                {hasActiveFilters ? (
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={clearFilters}
                  >
                    {t("doctor.filter.clear")}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  disabled={
                    visibleFindings.length === 0 || busy === "findings-export"
                  }
                  onClick={() => void copyVisibleFindings()}
                  title={t("doctor.finding.copyAllHint")}
                  data-testid="doctor-findings-copy-all"
                >
                  <IconCopy size={14} />
                  {t("doctor.finding.copyAll")}
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  disabled={
                    visibleFindings.length === 0 ||
                    !!busy ||
                    loading
                  }
                  onClick={onExportFindings}
                  title={t("doctor.finding.exportHint")}
                  data-testid="doctor-findings-export"
                >
                  {busy === "findings-export"
                    ? "…"
                    : t("doctor.finding.export")}
                </button>
              </div>

              {visibleFindings.length === 0 ? (
                <p className="doctor-modal__status">
                  {t("doctor.filter.empty")}
                </p>
              ) : (
                <ul className="doctor-checks doctor-findings__list">
                  {visibleFindings.map((row) => {
                    const fix = fixHandleForRow(row);
                    const isThisFixing =
                      busy === "fix" && fixingId === fix?.fixId;
                    const title = findingTitle(row, t);
                    return (
                      <li
                        key={row.key}
                        className={`doctor-check doctor-check--${row.level}`}
                      >
                        <div className="doctor-check__badge" aria-hidden>
                          <LevelIcon level={row.level} />
                        </div>
                        <div className="doctor-check__main">
                          <div className="doctor-check__row">
                            <span className="doctor-check__title">{title}</span>
                            <span
                              className={`doctor-check__level doctor-check__level--${row.level}`}
                            >
                              {t(levelLabelKey(row.level))}
                            </span>
                          </div>
                          <div className="doctor-findings__meta">
                            <span className="doctor-findings__tag">
                              {t(CATEGORY_LABEL_KEYS[row.category])}
                            </span>
                            <span className="doctor-findings__tag doctor-findings__tag--muted">
                              {row.source === "app"
                                ? t("doctor.filter.sourceApp")
                                : t("doctor.filter.sourceCli")}
                            </span>
                            {row.fixId ? (
                              <span
                                className="doctor-findings__tag doctor-findings__tag--mono"
                                title={row.fixId}
                              >
                                {row.fixId}
                              </span>
                            ) : null}
                          </div>
                          {row.detail && row.rawId !== "cli-doctor-clean" ? (
                            <p className="doctor-check__detail">{row.detail}</p>
                          ) : null}
                          <div className="doctor-check__actions">
                            <button
                              type="button"
                              className="btn btn--ghost btn--sm"
                              onClick={() => setDetailKey(row.key)}
                            >
                              {t("doctor.finding.detail")}
                            </button>
                            <button
                              type="button"
                              className="btn btn--ghost btn--sm"
                              onClick={() => void copyFinding(row)}
                              title={t("doctor.finding.copyOne")}
                            >
                              {copiedFindingKey === row.key ? (
                                <IconCheck size={14} />
                              ) : (
                                <IconCopy size={14} />
                              )}
                              {copiedFindingKey === row.key
                                ? t("doctor.finding.copied")
                                : t("doctor.finding.copyOne")}
                            </button>
                            {fix ? (
                              <button
                                type="button"
                                className="btn btn--ghost btn--sm"
                                disabled={!!busy || loading}
                                onClick={() => onApplyFix(fix)}
                                title={t("doctor.cliDoctorFixHint", {
                                  id: fix.fixId,
                                })}
                              >
                                {isThisFixing
                                  ? "…"
                                  : t("doctor.cliDoctorFix")}
                              </button>
                            ) : null}
                            {isAgentSidecarSkewFinding(row) ? (
                              <button
                                type="button"
                                className="btn btn--ghost btn--sm"
                                disabled={!!busy || loading}
                                onClick={() => void repairAgentSidecarSkew()}
                                title={t("doctor.agentSkewRepairHint")}
                                data-testid="doctor-repair-agent-skew"
                              >
                                {busy === "agent-skew-repair" &&
                                fixingId === APP_AGENT_SIDECAR_SKEW_FINDING_ID
                                  ? t("doctor.agentSkewRepairing")
                                  : t("doctor.agentSkewRepair")}
                              </button>
                            ) : null}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          )}

          {!loading && cliDoctor && (
            <section
              className="doctor-cli-section"
              aria-label={t("doctor.cliDoctor")}
            >
              <div className="doctor-cli-section__head">
                <h3 className="doctor-cli-section__title">
                  {t("doctor.cliDoctor")}
                </h3>
                <p className="doctor-cli-section__hint">
                  {t("doctor.cliDoctorHint")}
                </p>
              </div>

              {!cliDoctor.available && (
                <p className="doctor-modal__status doctor-modal__status--error">
                  {cliDoctor.reason === "cli_too_old"
                    ? t("doctor.cliTooOld")
                    : `${t("doctor.cliDoctorMissing")}${
                        cliDoctor.error ? `: ${cliDoctor.error}` : ""
                      }`}
                </p>
              )}

              {cliDoctor.available && fixPlan.total > 0 && (
                <div
                  className="doctor-cli-fix-plan"
                  role="status"
                  aria-live="polite"
                >
                  <p className="doctor-cli-fix-plan__banner">
                    {t("doctor.cliDoctorFixPlanBanner", {
                      total: fixPlan.total,
                      confirm: fixPlan.needsConfirm,
                    })}
                  </p>
                  {fixPlan.safe > 0 ? (
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      disabled={!!busy || loading}
                      onClick={() => void applySafeFixes()}
                      title={t("doctor.cliDoctorApplySafeFixesHint")}
                    >
                      {busy === "fix" &&
                      fixingId &&
                      safeAutoFixes.some((c) => c.fixId === fixingId)
                        ? "…"
                        : t("doctor.cliDoctorApplySafeFixes")}
                    </button>
                  ) : null}
                </div>
              )}

              {/* Fallback strip when findings carry automaticRemediation but
                  were not already rendered as check rows (older host shapes). */}
              {cliDoctor.available &&
                cliFixes.length > 0 &&
                !cliDoctor.checks.some((c) => c.fixId) && (
                  <div className="doctor-cli-fixes">
                    <div className="doctor-cli-fixes__title">
                      {t("doctor.cliDoctorFixes")}
                    </div>
                    <ul className="doctor-cli-fixes__list">
                      {cliFixes.map((f) => (
                        <li key={f.fixId} className="doctor-cli-fixes__item">
                          <div className="doctor-cli-fixes__text">
                            <span className="doctor-cli-fixes__id">
                              {f.fixId}
                            </span>
                            {f.message ? (
                              <span className="doctor-cli-fixes__msg">
                                {f.message}
                              </span>
                            ) : null}
                          </div>
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            disabled={!!busy || loading}
                            onClick={() => onApplyFix(f)}
                          >
                            {busy === "fix" && fixingId === f.fixId
                              ? "…"
                              : t("doctor.cliDoctorFix")}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

              {cliDoctor.available &&
                hasAnySafeFact(cliDoctor.facts) &&
                cliFacts.length > 0 && (
                  <details className="doctor-cli-facts">
                    <summary className="doctor-cli-facts__summary">
                      {t("doctor.cliDoctorFacts")}
                    </summary>
                    <dl className="doctor-cli-facts__list">
                      {cliFacts.map(({ key, value }) => (
                        <div key={key} className="doctor-cli-facts__row">
                          <dt>{t(FACT_LABEL_KEYS[key])}</dt>
                          <dd>{value}</dd>
                        </div>
                      ))}
                    </dl>
                  </details>
                )}

              {cliDoctor.available && cliDoctor.probeNotes.length > 0 && (
                <details className="doctor-cli-facts">
                  <summary className="doctor-cli-facts__summary">
                    {t("doctor.cliDoctorProbeNotes", {
                      count: cliDoctor.probeNotes.length,
                    })}
                  </summary>
                  <ul className="doctor-cli-probes">
                    {cliDoctor.probeNotes.map((n) => (
                      <li key={n.probe} className="doctor-cli-probes__item">
                        <span className="doctor-cli-probes__name">{n.probe}</span>
                        <span className="doctor-cli-probes__status">
                          {n.status}
                        </span>
                        {n.message ? (
                          <span className="doctor-cli-probes__msg">
                            {n.message}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </section>
          )}

          {!loading && (
            <section
              className="doctor-platform-matrix"
              aria-label={t("doctor.platformMatrix.title")}
              data-testid="doctor-platform-matrix"
            >
              <div className="doctor-platform-matrix__head">
                <h3 className="doctor-platform-matrix__title">
                  {t("doctor.platformMatrix.title")}
                </h3>
                <p className="doctor-platform-matrix__hint">
                  {t("doctor.platformMatrix.hint")}
                </p>
              </div>
              <div className="doctor-platform-matrix__table-wrap">
                <table className="doctor-platform-matrix__table">
                  <thead>
                    <tr>
                      <th scope="col">
                        {t("doctor.platformMatrix.col.capability")}
                      </th>
                      <th scope="col">
                        {t("doctor.platformMatrix.col.status")}
                      </th>
                      <th scope="col">
                        {t("doctor.platformMatrix.col.detail")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {platformMatrix.rows.map((row) => {
                      const tone = doctorPlatformCellTone(row.status);
                      return (
                        <tr
                          key={row.rowId}
                          className={`doctor-platform-matrix__row doctor-platform-matrix__row--${tone}`}
                          data-row-id={row.rowId}
                          data-status={row.status}
                        >
                          <th scope="row">{t(row.labelKey)}</th>
                          <td>
                            <span
                              className={`doctor-platform-matrix__badge doctor-platform-matrix__badge--${tone}`}
                            >
                              {t(doctorPlatformCellStatusKey(row.status))}
                            </span>
                          </td>
                          <td className="doctor-platform-matrix__detail">
                            {t(row.messageKey)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {windowsDayuseEmpty.show ? (
            <section
              className="doctor-windows-dayuse"
              aria-labelledby="doctor-windows-dayuse-title"
              data-testid="doctor-windows-dayuse"
            >
              <header className="doctor-windows-dayuse__head">
                <div className="doctor-windows-dayuse__title-row">
                  <h3
                    id="doctor-windows-dayuse-title"
                    className="doctor-windows-dayuse__title"
                  >
                    {t("doctor.windowsDayuse.title")}
                  </h3>
                  <span
                    className="doctor-windows-dayuse__badge"
                    data-platform={windowsDayuseChecklist.platform}
                  >
                    {t(
                      windowsDayusePlatformBadgeKey(
                        windowsDayuseChecklist.platform,
                      ) as MessageKey,
                    )}
                  </span>
                </div>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  disabled={!!busy || loading}
                  onClick={() => void onCopyWindowsDayuse()}
                  data-testid="doctor-windows-dayuse-copy"
                >
                  {busy === "dayuse-copy"
                    ? "…"
                    : t("doctor.windowsDayuse.copy")}
                </button>
              </header>
              <p className="doctor-windows-dayuse__lead">
                {windowsDayuseEmpty.isTargetPlatform
                  ? t("doctor.windowsDayuse.lead")
                  : t("doctor.windowsDayuse.notTarget")}
              </p>
              {windowsDayuseEmpty.isTargetPlatform ? (
                <p
                  className="doctor-windows-dayuse__summary"
                  aria-live="polite"
                >
                  {t("doctor.windowsDayuse.summary", {
                    pass: windowsDayuseChecklist.counts.pass,
                    fail: windowsDayuseChecklist.counts.fail,
                    manual: windowsDayuseChecklist.counts.manual,
                    na: windowsDayuseChecklist.counts.na,
                  })}
                </p>
              ) : null}
              <ul className="doctor-windows-dayuse__list">
                {windowsDayuseChecklist.items.map((item) => {
                  const tone = windowsDayuseStatusTone(item.status);
                  return (
                    <li
                      key={item.id}
                      className="doctor-windows-dayuse__row"
                      data-status={item.status}
                      data-testid={`doctor-windows-dayuse-item-${item.id}`}
                    >
                      <div className="doctor-windows-dayuse__row-main">
                        <span
                          className={
                            "doctor-windows-dayuse__chip doctor-windows-dayuse__chip--" +
                            tone
                          }
                        >
                          {t(windowsDayuseStatusKey(item.status) as MessageKey)}
                        </span>
                        <span className="doctor-windows-dayuse__label">
                          {t(item.labelKey as MessageKey)}
                        </span>
                        {item.link ? (
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm doctor-windows-dayuse__link"
                            disabled={!!busy || loading}
                            onClick={() => openDayuseLink(item.link)}
                          >
                            {item.link === "about"
                              ? t("doctor.windowsDayuse.link.about")
                              : item.link === "mirror"
                                ? t("doctor.windowsDayuse.link.mirror")
                                : item.link === "runtime"
                                  ? t("doctor.windowsDayuse.link.runtime")
                                  : t("doctor.windowsDayuse.link.setup")}
                          </button>
                        ) : null}
                      </div>
                      <p className="doctor-windows-dayuse__detail">
                        {t(item.detailKey as MessageKey)}
                      </p>
                    </li>
                  );
                })}
              </ul>
              <p className="doctor-windows-dayuse__docs">
                <span className="doctor-windows-dayuse__docs-label">
                  {t("doctor.windowsDayuse.docs")}
                </span>
                <code className="doctor-windows-dayuse__docs-path">
                  {WINDOWS_DAYUSE_DOCS_PATH}
                </code>
              </p>
            </section>
          ) : null}


          {linuxDayuseEmpty.show ? (
            <section
              className="doctor-linux-dayuse"
              aria-labelledby="doctor-linux-dayuse-title"
              data-testid="doctor-linux-dayuse"
            >
              <header className="doctor-linux-dayuse__head">
                <div className="doctor-linux-dayuse__title-row">
                  <h3
                    id="doctor-linux-dayuse-title"
                    className="doctor-linux-dayuse__title"
                  >
                    {t("doctor.linuxDayuse.title")}
                  </h3>
                  <span
                    className="doctor-linux-dayuse__badge"
                    data-platform={linuxDayuseChecklist.platform}
                  >
                    {t(
                      linuxDayusePlatformBadgeKey(
                        linuxDayuseChecklist.platform,
                      ) as MessageKey,
                    )}
                  </span>
                </div>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  disabled={!!busy || loading}
                  onClick={() => void onCopyLinuxDayuse()}
                  data-testid="doctor-linux-dayuse-copy"
                >
                  {busy === "dayuse-copy"
                    ? "…"
                    : t("doctor.linuxDayuse.copy")}
                </button>
              </header>
              <p className="doctor-linux-dayuse__lead">
                {linuxDayuseEmpty.isTargetPlatform
                  ? t("doctor.linuxDayuse.lead")
                  : t("doctor.linuxDayuse.notTarget")}
              </p>
              {linuxDayuseEmpty.isTargetPlatform ? (
                <p
                  className="doctor-linux-dayuse__summary"
                  aria-live="polite"
                >
                  {t("doctor.linuxDayuse.summary", {
                    pass: linuxDayuseChecklist.counts.pass,
                    fail: linuxDayuseChecklist.counts.fail,
                    warn: linuxDayuseChecklist.counts.warn,
                    manual: linuxDayuseChecklist.counts.manual,
                    na: linuxDayuseChecklist.counts.na,
                  })}
                </p>
              ) : null}
              <ul className="doctor-linux-dayuse__list">
                {linuxDayuseChecklist.items.map((item) => {
                  const tone = linuxDayuseStatusTone(item.status);
                  return (
                    <li
                      key={item.id}
                      className="doctor-linux-dayuse__row"
                      data-status={item.status}
                      data-testid={`doctor-linux-dayuse-item-${item.id}`}
                    >
                      <div className="doctor-linux-dayuse__row-main">
                        <span
                          className={
                            "doctor-linux-dayuse__chip doctor-linux-dayuse__chip--" +
                            tone
                          }
                        >
                          {t(linuxDayuseStatusKey(item.status) as MessageKey)}
                        </span>
                        <span className="doctor-linux-dayuse__label">
                          {t(item.labelKey as MessageKey)}
                        </span>
                        {item.link ? (
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm doctor-linux-dayuse__link"
                            disabled={!!busy || loading}
                            onClick={() => openDayuseLink(item.link)}
                          >
                            {item.link === "about"
                              ? t("doctor.linuxDayuse.link.about")
                              : item.link === "sandbox"
                                ? t("doctor.linuxDayuse.link.sandbox")
                                : item.link === "runtime"
                                  ? t("doctor.linuxDayuse.link.runtime")
                                  : t("doctor.linuxDayuse.link.setup")}
                          </button>
                        ) : null}
                      </div>
                      <p className="doctor-linux-dayuse__detail">
                        {t(item.detailKey as MessageKey)}
                      </p>
                    </li>
                  );
                })}
              </ul>
              <p className="doctor-linux-dayuse__docs">
                <span className="doctor-linux-dayuse__docs-label">
                  {t("doctor.linuxDayuse.docs")}
                </span>
                <code className="doctor-linux-dayuse__docs-path">
                  {LINUX_DAYUSE_DOCS_PATH}
                </code>
              </p>
            </section>
          ) : null}

          <section className="doctor-advanced" aria-label={t("doctor.advanced")}>
            <h3 className="doctor-advanced__title">{t("doctor.advanced")}</h3>
            <div className="doctor-advanced__cli-update">
              <div className="doctor-advanced__text doctor-advanced__cli-update-head">
                <div className="doctor-advanced__label">{t("doctor.cliUpdate")}</div>
                <p className="doctor-advanced__hint">{t("doctor.cliUpdateHint")}</p>
              </div>
              <CliUpdateRow
                t={t}
                cliFound={
                  report?.checks?.find((c) => c.id === "cli")?.level !== "fail"
                }
                compact
              />
            </div>
            {onOpenReliability ? (
              <div className="doctor-advanced__row">
                <div className="doctor-advanced__text">
                  <div className="doctor-advanced__label">
                    {t("doctor.openReliability")}
                  </div>
                  <p className="doctor-advanced__hint">
                    {t("doctor.openReliabilityHint")}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  disabled={!!busy || loading}
                  onClick={() => {
                    onClose();
                    onOpenReliability();
                  }}
                >
                  {t("doctor.openReliability")}
                </button>
              </div>
            ) : null}
            <div className="doctor-advanced__row">
              <div className="doctor-advanced__text">
                <div className="doctor-advanced__label">{t("doctor.supportZip")}</div>
                <p className="doctor-advanced__hint">{t("doctor.supportZipHint")}</p>
              </div>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                disabled={
                  !!busy ||
                  loading ||
                  !canSupportBundleExport({ isHost: api.isTauri() })
                }
                onClick={onSupportZipRequest}
                title={t("doctor.supportZipHint")}
                data-testid="doctor-support-zip"
              >
                {busy === "zip" ? "…" : t("doctor.supportZip")}
              </button>
            </div>
            <div className="doctor-advanced__row doctor-advanced__row--danger">
              <div className="doctor-advanced__text">
                <div className="doctor-advanced__label">{t("doctor.reset")}</div>
                <p className="doctor-advanced__hint">{t("doctor.resetHint")}</p>
                <label className="doctor-advanced__check">
                  <input
                    type="checkbox"
                    checked={keepSecrets}
                    onChange={(e) => setKeepSecrets(e.target.checked)}
                    disabled={!!busy}
                  />
                  <span>{t("doctor.resetKeepSecrets")}</span>
                </label>
              </div>
              <button
                type="button"
                className="btn btn--ghost btn--sm doctor-advanced__danger-btn"
                disabled={!!busy || loading}
                onClick={onResetClick}
              >
                {busy === "reset" ? "…" : t("doctor.reset")}
              </button>
            </div>
          </section>
        </div>

        <footer className="doctor-modal__foot">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => void run()}
            disabled={loading || !!busy}
          >
            <IconRefresh size={14} />
            {t("doctor.rerun")}
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => void onCopyReport()}
            disabled={!report || loading || !!busy}
          >
            {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
            {copied ? t("doctor.copied") : t("doctor.copy")}
          </button>
          <span className="doctor-modal__foot-spacer" />
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={onClose}
            disabled={!!busy}
          >
            {t("doctor.close")}
          </button>
        </footer>
      </div>

      <GlassModal
        open={!!detailPresentation}
        onClose={() => setDetailKey(null)}
        title={
          detailPresentation
            ? findingTitle(detailPresentation.row, t)
            : t("doctor.finding.detailTitle")
        }
        size="md"
        closeLabel={t("common.close")}
        wrapBody
        bodyClassName="doctor-finding-detail"
        className="doctor-finding-detail-modal"
        footer={
          detailPresentation ? (
            <>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => void copyFinding(detailPresentation.row)}
              >
                <IconCopy size={14} />
                {copiedFindingKey === detailPresentation.row.key
                  ? t("doctor.finding.copied")
                  : t("doctor.finding.copyOne")}
              </button>
              {fixHandleForRow(detailPresentation.row) ? (
                <button
                  type="button"
                  className="btn btn--ghost"
                  disabled={!!busy || loading}
                  onClick={() => {
                    const h = fixHandleForRow(detailPresentation.row);
                    if (h) onApplyFix(h);
                  }}
                >
                  {busy === "fix" &&
                  fixingId === fixHandleForRow(detailPresentation.row)?.fixId
                    ? "…"
                    : t("doctor.cliDoctorFix")}
                </button>
              ) : null}
              <button
                type="button"
                className="btn btn--solid"
                onClick={() => setDetailKey(null)}
              >
                {t("common.close")}
              </button>
            </>
          ) : null
        }
      >
        {detailPresentation ? (
          <div className="doctor-finding-detail__body">
            <div className="doctor-finding-detail__meta">
              <span
                className={
                  "doctor-check__level doctor-check__level--" +
                  detailPresentation.row.level
                }
              >
                {t(levelLabelKey(detailPresentation.row.level))}
              </span>
              <span className="doctor-findings__tag">
                {t(CATEGORY_LABEL_KEYS[detailPresentation.row.category])}
              </span>
              <span className="doctor-findings__tag doctor-findings__tag--muted">
                {detailPresentation.row.source === "app"
                  ? t("doctor.filter.sourceApp")
                  : t("doctor.filter.sourceCli")}
              </span>
            </div>
            <p className="doctor-finding-detail__id">
              <span className="doctor-finding-detail__label">
                {t("doctor.finding.id")}
              </span>
              <code>{detailPresentation.row.rawId}</code>
            </p>
            {detailPresentation.row.disposition ? (
              <p className="doctor-finding-detail__id">
                <span className="doctor-finding-detail__label">
                  {t("doctor.finding.disposition")}
                </span>
                <code>{detailPresentation.row.disposition}</code>
              </p>
            ) : null}
            {detailPresentation.fixId ? (
              <p className="doctor-finding-detail__id">
                <span className="doctor-finding-detail__label">
                  {t("doctor.finding.fixId")}
                </span>
                <code>
                  {detailPresentation.fixId}
                  {detailPresentation.destructive
                    ? ` · ${t("doctor.finding.destructive")}`
                    : ""}
                </code>
              </p>
            ) : null}
            {detailPresentation.detail ? (
              <p className="doctor-finding-detail__detail">
                {detailPresentation.detail}
              </p>
            ) : (
              <p className="doctor-field-hint doctor-finding-detail__empty">
                {t("doctor.finding.noDetail")}
              </p>
            )}
          </div>
        ) : null}
      </GlassModal>
      <GlassModal
        open={confirmSupportZip}
        onClose={() => setConfirmSupportZip(false)}
        title={t("reliability.supportZip.confirmTitle")}
        size="md"
        closeLabel={t("common.cancel")}
        titleId="doctor-support-zip-confirm-title"
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setConfirmSupportZip(false)}
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn--solid"
              onClick={() => void doSupportZip()}
              disabled={!!busy || loading}
              data-testid="doctor-support-zip-confirm"
            >
              {t("reliability.supportZip.confirmAction")}
            </button>
          </>
        }
      >
        <div
          className="app-dialog__msg"
          style={{ margin: 0, padding: "12px 16px" }}
          data-testid="doctor-support-zip-checklist"
        >
          <p style={{ margin: "0 0 8px" }}>
            {t("reliability.supportZip.confirmMessage")}
          </p>
          <p
            className="doctor-advanced__hint"
            style={{ margin: "0 0 10px" }}
          >
            {t("reliability.supportZip.secretsNever")}
          </p>
          <p style={{ margin: "0 0 6px", fontWeight: 600 }}>
            {t("reliability.supportZip.checklistTitle")}
          </p>
          <ul
            className="doctor-support-checklist"
            style={{
              margin: "0 0 10px",
              padding: "0 0 0 1.1em",
              listStyle: "disc",
            }}
          >
            {supportPlan.sections.map((s) => (
              <li
                key={s.id}
                data-section={s.id}
                data-included={s.included ? "1" : "0"}
                style={{
                  marginBottom: 4,
                  opacity: s.included ? 1 : 0.55,
                }}
              >
                <span aria-hidden>{s.included ? "✓ " : "– "}</span>
                {t(s.labelKey as MessageKey)}
                {s.included && s.redacted
                  ? ` · ${t("reliability.supportZip.redacted")}`
                  : null}
                {!s.included
                  ? ` · ${t("reliability.supportZip.sectionOmitted")}`
                  : s.availability === "when_available"
                    ? ` · ${t("reliability.supportZip.whenAvailable")}`
                    : null}
              </li>
            ))}
          </ul>
          <details style={{ marginTop: 4 }}>
            <summary style={{ cursor: "pointer" }}>
              {t("reliability.supportZip.manifestPreview")}
            </summary>
            <pre
              className="doctor-support-manifest"
              style={{
                margin: "8px 0 0",
                padding: 8,
                fontSize: 11,
                lineHeight: 1.4,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                maxHeight: 160,
                overflow: "auto",
                borderRadius: 6,
                background: "var(--surface-2, rgba(0,0,0,0.06))",
              }}
              data-testid="doctor-support-manifest"
            >
              {supportManifestText}
            </pre>
          </details>
        </div>
      </GlassModal>
    </div>
  );
}
