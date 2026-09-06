/**
 * Git worktree chrome: list, create, GC, ship, switch/remove, session badges.
 * Host fills {@link GitWorktreeChromeHost} in place so bind/open/settings
 * verbs stay late-bound at the composition root.
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
import { createT } from "@/i18n";
import type { SidebarSessionWorktreeBadgeProp } from "@/components/SidebarSessionRow";
import * as api from "@/lib/api";
import type { AppDialog } from "@/lib/app/appDialogTypes";
import {
  mapProjectsList,
  normalizeSessionRow,
  type Project,
  type SessionRow,
} from "@/lib/app/sidebarModels";
import { filterCliWorktreesForProject } from "@/lib/cliWorktrees";
import {
  applyGitStatusBranch,
  buildWorktreePath,
  canRemoveWorktree,
  mainWorktreePath,
  normalizeWorktreeLayout,
  pathsEqual,
  resolveSessionWorktreeBadge,
  sanitizeWorktreeName,
  sanitizeWorktreeRef,
  sessionWorktreeTooltip,
  worktreeRemoveErrorSuggestsForce,
  type SessionWorktreeBadge,
  type WorktreeLayout,
} from "@/lib/gitWorktree";
import {
  PR_HUB_ANCHOR_ID,
  buildPrHubDeepLink,
  parseGithubPrNumber,
} from "@/lib/prHubDeepLink";
import type { SettingsSectionId } from "@/lib/settingsCatalog";
import {
  canShipWorktree,
  combineShipOutcome,
  defaultPrTitleFromBranch,
  redactShipOutput,
  sanitizePrBody,
  sanitizePrTitle,
  shipOutcomeSummary,
} from "@/lib/wtShipFlow";

type TFn = ReturnType<typeof createT>;

type GitStatusPatch = {
  available?: boolean | null;
  branch?: string | null;
};

export type GitWorktreeCreateOverlay = {
  open: boolean;
  busy: boolean;
  startChat: boolean;
  name: string;
  layout: WorktreeLayout;
  startRef: string;
  previewPath: string | null;
  error: string | null;
  close: () => void;
  submit: () => void;
  setName: (value: string) => void;
  setLayout: (value: WorktreeLayout) => void;
  setRef: (value: string) => void;
};

export type GitWorktreeGcOverlay = {
  open: boolean;
  busy: boolean;
  previewBusy: boolean;
  force: boolean;
  preview: api.GitWorktreeGcResult | null;
  error: string | null;
  close: () => void;
  submit: () => void;
  setForce: (value: boolean) => void;
};

export type GitWorktreeShipOverlay = {
  open: boolean;
  busy: boolean;
  success: { prUrl: string; prNumber: number | null } | null;
  title: string;
  body: string;
  createPr: boolean;
  draft: boolean;
  branch: string | null;
  status: string | null;
  error: string | null;
  close: () => void;
  submit: () => void;
  setTitle: (value: string) => void;
  setBody: (value: string) => void;
  setCreatePr: (value: boolean) => void;
  setDraft: (value: boolean) => void;
  openPrHub: (prNumber: number | null) => void;
};

export type GitWorktreeChromeOverlay = {
  create: GitWorktreeCreateOverlay;
  gc: GitWorktreeGcOverlay;
  ship: GitWorktreeShipOverlay;
};

export type GitWorktreeChromeHost = {
  tr: TFn;
  activeProject: Project | null;
  projects: Project[];
  session: { sessionId: string | null };
  sessions: SessionRow[];
  showToast: (msg: string, ms?: number) => void;
  setAppDialog: (dialog: NonNullable<AppDialog>) => void;
  bindSessionProject: (proj: Project | null) => void | Promise<void>;
  finalizeAddedProject: (
    p: Project,
    opts: { bindSession: boolean },
  ) => void | Promise<void>;
  setProjects: Dispatch<SetStateAction<Project[]>>;
  setExpandedProjects: Dispatch<SetStateAction<Record<string, boolean>>>;
  assignNewProjects: (ids: readonly string[]) => void;
  refreshSessions: () => void | Promise<void>;
  openSession: (
    row: SessionRow,
    project?: Project | null,
  ) => void | Promise<void>;
  viewingSessionIdRef: MutableRefObject<string | null>;
  navigateSettings: (
    section?: SettingsSectionId | null,
    tab?: string | null,
  ) => void;
  setPrHubHighlightPr: (n: number | null) => void;
  setSettingsFocusAnchor: (id: string | null) => void;
};

function emptyHost(): GitWorktreeChromeHost {
  const noop = () => {};
  return {
    tr: ((k: string) => k) as TFn,
    activeProject: null,
    projects: [],
    session: { sessionId: null },
    sessions: [],
    showToast: noop,
    setAppDialog: noop,
    bindSessionProject: noop,
    finalizeAddedProject: noop,
    setProjects: noop,
    setExpandedProjects: noop,
    assignNewProjects: noop,
    refreshSessions: noop,
    openSession: noop,
    viewingSessionIdRef: { current: null },
    navigateSettings: noop,
    setPrHubHighlightPr: noop,
    setSettingsFocusAnchor: noop,
  };
}

export function createGitWorktreeChromeHost(): GitWorktreeChromeHost {
  return emptyHost();
}

export function useGitWorktreeChrome(opts: {
  hostRef: MutableRefObject<GitWorktreeChromeHost>;
  projectPath: string | null;
}) {
  const hostRef = opts.hostRef;
  const [gitWorktrees, setGitWorktrees] = useState<api.GitWorktreeEntry[]>([]);
  const [gitWorktreesAvailable, setGitWorktreesAvailable] = useState<
    boolean | null
  >(null);
  const [gitWorktreesLoading, setGitWorktreesLoading] = useState(false);
  const [gitWorktreesReason, setGitWorktreesReason] = useState<string | null>(
    null,
  );
  const [worktreeCreateOpen, setWorktreeCreateOpen] = useState(false);
  const [worktreeCreateName, setWorktreeCreateName] = useState("");
  const [worktreeCreateRef, setWorktreeCreateRef] = useState("");
  const [worktreeCreateLayout, setWorktreeCreateLayout] =
    useState<WorktreeLayout>("cli");
  const [worktreeCreateBusy, setWorktreeCreateBusy] = useState(false);
  const [worktreeCreateError, setWorktreeCreateError] = useState<string | null>(
    null,
  );
  const [worktreeCreateStartChat, setWorktreeCreateStartChat] = useState(false);
  const [cliGrokHome, setCliGrokHome] = useState<string | null>(null);
  const [cliWorktrees, setCliWorktrees] = useState<api.CliWorktreeEntry[]>([]);
  const [cliWorktreesAvailable, setCliWorktreesAvailable] = useState<
    boolean | null
  >(null);
  const [cliWorktreesLoading, setCliWorktreesLoading] = useState(false);
  const [cliWorktreesReason, setCliWorktreesReason] = useState<string | null>(
    null,
  );
  const [worktreeGcOpen, setWorktreeGcOpen] = useState(false);
  const [worktreeGcForce, setWorktreeGcForce] = useState(false);
  const [worktreeGcBusy, setWorktreeGcBusy] = useState(false);
  const [worktreeGcPreviewBusy, setWorktreeGcPreviewBusy] = useState(false);
  const [worktreeGcError, setWorktreeGcError] = useState<string | null>(null);
  const [worktreeGcPreview, setWorktreeGcPreview] =
    useState<api.GitWorktreeGcResult | null>(null);
  const [shipOpen, setShipOpen] = useState(false);
  const [shipTitle, setShipTitle] = useState("");
  const [shipBody, setShipBody] = useState("");
  const [shipDraft, setShipDraft] = useState(false);
  const [shipCreatePr, setShipCreatePr] = useState(true);
  const [shipBusy, setShipBusy] = useState(false);
  const [shipError, setShipError] = useState<string | null>(null);
  const [shipBranch, setShipBranch] = useState<string | null>(null);
  const [shipStatus, setShipStatus] = useState<string | null>(null);
  const [shipSuccess, setShipSuccess] = useState<{
    prUrl: string;
    prNumber: number | null;
  } | null>(null);

  const gitWorktreesReqRef = useRef(0);
  const gitWorktreesPathRef = useRef<string | null>(null);
  const refreshGitWorktrees = useCallback(async () => {
    const path = opts.projectPath?.trim() || null;
    if (!path || !api.isTauri()) {
      gitWorktreesReqRef.current += 1;
      gitWorktreesPathRef.current = null;
      setGitWorktrees([]);
      setGitWorktreesAvailable(null);
      setGitWorktreesReason(null);
      setCliGrokHome(null);
      setGitWorktreesLoading(false);
      return;
    }
    const reqId = ++gitWorktreesReqRef.current;
    // Drop stale rows when the active path changes; same-path refresh keeps
    // the previous list so the menu does not flash empty.
    if (gitWorktreesPathRef.current !== path) {
      gitWorktreesPathRef.current = path;
      setGitWorktrees([]);
      setGitWorktreesAvailable(null);
      setGitWorktreesReason(null);
    }
    setGitWorktreesLoading(true);
    try {
      const res = await api.gitWorktreesList(path);
      if (reqId !== gitWorktreesReqRef.current) return;
      const home = (res.cliGrokHome || "").trim() || null;
      if (home) setCliGrokHome(home);
      if (!res.available) {
        setGitWorktrees([]);
        setGitWorktreesAvailable(false);
        setGitWorktreesReason(res.reason?.trim() || "unavailable");
      } else {
        setGitWorktrees(res.worktrees ?? []);
        setGitWorktreesAvailable(true);
        setGitWorktreesReason(null);
      }
    } catch (e) {
      if (reqId !== gitWorktreesReqRef.current) return;
      setGitWorktrees([]);
      setGitWorktreesAvailable(false);
      setGitWorktreesReason(String(e));
    } finally {
      if (reqId === gitWorktreesReqRef.current) {
        setGitWorktreesLoading(false);
      }
    }
  }, [opts.projectPath]);

  useEffect(() => {
    void refreshGitWorktrees();
  }, [refreshGitWorktrees]);

  const cliWorktreesReqRef = useRef(0);
  const refreshCliWorktrees = useCallback(async () => {
    const h = hostRef.current;
    if (!api.isTauri()) {
      cliWorktreesReqRef.current += 1;
      setCliWorktrees([]);
      setCliWorktreesAvailable(null);
      setCliWorktreesReason(null);
      setCliWorktreesLoading(false);
      return;
    }
    const reqId = ++cliWorktreesReqRef.current;
    setCliWorktreesLoading(true);
    try {
      const projectPath = h.activeProject?.path?.trim() || null;
      const repoSlug = projectPath
        ? projectPath.replace(/\\/g, "/").split("/").filter(Boolean).pop() ||
          null
        : null;
      const res = await api.cliWorktreesList({
        all: false,
        // CLI --repo matches repo_name, not folder basename. Leave unfiltered;
        // UI filters by source path / worktrees slug.
        repo: null,
      });
      if (reqId !== cliWorktreesReqRef.current) return;
      if (!res.available) {
        setCliWorktrees([]);
        setCliWorktreesAvailable(false);
        setCliWorktreesReason(res.reason?.trim() || "unavailable");
      } else {
        const filtered = filterCliWorktreesForProject(
          res.worktrees ?? [],
          projectPath,
          repoSlug,
        );
        setCliWorktrees(filtered);
        setCliWorktreesAvailable(true);
        setCliWorktreesReason(null);
      }
    } catch (e) {
      if (reqId !== cliWorktreesReqRef.current) return;
      setCliWorktrees([]);
      setCliWorktreesAvailable(false);
      setCliWorktreesReason(String(e));
    } finally {
      if (reqId === cliWorktreesReqRef.current) {
        setCliWorktreesLoading(false);
      }
    }
  }, [hostRef]);

  useEffect(() => {
    if (gitWorktreesAvailable === true) {
      void refreshCliWorktrees();
    } else if (gitWorktreesAvailable === false) {
      cliWorktreesReqRef.current += 1;
      setCliWorktrees([]);
      setCliWorktreesAvailable(null);
      setCliWorktreesReason(null);
      setCliWorktreesLoading(false);
    }
  }, [gitWorktreesAvailable, refreshCliWorktrees]);

  const applyStatusBranch = useCallback(
    (path: string, status: GitStatusPatch | null | undefined) => {
      setGitWorktrees((prev) => applyGitStatusBranch(prev, path, status));
    },
    [],
  );

  const openWorktreeGc = useCallback(() => {
    setWorktreeGcForce(false);
    setWorktreeGcError(null);
    setWorktreeGcBusy(false);
    setWorktreeGcPreview(null);
    setWorktreeGcOpen(true);
  }, []);

  const openShipFlow = useCallback(() => {
    const h = hostRef.current;
    if (!api.isTauri() || !h.activeProject?.path) {
      h.showToast(h.tr("composer.worktreeShipNeedProject"), 3500);
      return;
    }
    const current =
      gitWorktrees.find((w) => pathsEqual(w.path, h.activeProject!.path)) ??
      null;
    const branch =
      current?.branch?.trim() ||
      (h.session.sessionId
        ? h.sessions.find((s) => s.id === h.session.sessionId)?.worktreeBranch
        : null) ||
      null;
    if (
      !canShipWorktree({
        branch,
        detached: current?.detached ?? !branch,
        available: gitWorktreesAvailable,
      })
    ) {
      if (current?.detached) {
        h.showToast(h.tr("composer.worktreeShipDetached"), 4000);
        return;
      }
    }
    setShipBranch(branch);
    setShipTitle(defaultPrTitleFromBranch(branch));
    setShipBody("");
    setShipDraft(false);
    setShipCreatePr(true);
    setShipError(null);
    setShipStatus(null);
    setShipSuccess(null);
    setShipBusy(false);
    setShipOpen(true);
  }, [gitWorktrees, gitWorktreesAvailable, hostRef]);

  const closeShipFlow = useCallback(() => {
    if (shipBusy) return;
    setShipOpen(false);
    setShipError(null);
    setShipStatus(null);
    setShipSuccess(null);
  }, [shipBusy]);

  const openPrHubFromShip = useCallback(
    (prNumber: number | null) => {
      const h = hostRef.current;
      try {
        if (!h.activeProject?.path?.trim()) {
          h.showToast(h.tr("composer.worktreeShipOpenHubFailed"), 4000);
          return;
        }
        h.setPrHubHighlightPr(prNumber);
        h.setSettingsFocusAnchor(PR_HUB_ANCHOR_ID);
        h.navigateSettings("runtime", "tools");
        if (typeof window !== "undefined") {
          const hash = buildPrHubDeepLink({ prNumber });
          if (window.location.hash !== hash) {
            window.location.hash = hash;
          }
        }
        setShipOpen(false);
        setShipSuccess(null);
        setShipError(null);
        setShipStatus(null);
      } catch {
        h.showToast(h.tr("composer.worktreeShipOpenHubFailed"), 4000);
      }
    },
    [hostRef],
  );

  const submitShipFlow = useCallback(async () => {
    const h = hostRef.current;
    if (!api.isTauri() || !h.activeProject?.path) return;
    let title: string;
    let body: string;
    try {
      title = sanitizePrTitle(shipTitle);
      body = sanitizePrBody(shipBody);
    } catch (e) {
      setShipError(String(e));
      return;
    }
    setShipBusy(true);
    setShipError(null);
    setShipSuccess(null);
    setShipStatus(h.tr("composer.worktreeShipPushing"));
    try {
      const push = await api.gitPushBranch(h.activeProject.path);
      let pr: api.GhPrCreateResult | null = null;
      if (shipCreatePr) {
        setShipStatus(h.tr("composer.worktreeShipCreatingPr"));
        pr = await api.ghPrCreate({
          projectPath: h.activeProject.path,
          title,
          body,
          draft: shipDraft,
          base: "main",
        });
      }
      const outcome = combineShipOutcome(push, pr, {
        createPr: shipCreatePr,
      });
      const summary = shipOutcomeSummary(outcome);
      if (outcome.ok) {
        setShipStatus(null);
        if (outcome.prUrl) {
          const prNumber = parseGithubPrNumber(outcome.prUrl);
          setShipSuccess({ prUrl: outcome.prUrl, prNumber });
        } else {
          setShipOpen(false);
          setShipSuccess(null);
        }
      } else {
        const detail = redactShipOutput(
          outcome.failReason ||
            pr?.reason ||
            push.reason ||
            summary ||
            "ship failed",
          600,
        );
        setShipError(detail);
        setShipStatus(null);
        h.showToast(
          shipCreatePr
            ? h.tr("composer.worktreeShipFailed", { reason: detail })
            : h.tr("composer.worktreeShipPushFailed", { reason: detail }),
          6000,
        );
      }
    } catch (e) {
      const msg = redactShipOutput(String(e), 600);
      setShipError(msg);
      setShipStatus(null);
      h.showToast(h.tr("composer.worktreeShipFailed", { reason: msg }), 6000);
    } finally {
      setShipBusy(false);
    }
  }, [hostRef, shipBody, shipCreatePr, shipDraft, shipTitle]);

  const refreshWorktreeGcPreview = useCallback(async () => {
    const h = hostRef.current;
    if (!api.isTauri() || !h.activeProject?.path || !worktreeGcOpen) return;
    setWorktreeGcPreviewBusy(true);
    setWorktreeGcError(null);
    try {
      // Object form — positional (path, force, dryRun) is easy to invert.
      const res = await api.gitWorktreeGc({
        projectPath: h.activeProject.path,
        dryRun: true,
        force: worktreeGcForce,
      });
      setWorktreeGcPreview(res);
    } catch (e) {
      setWorktreeGcPreview(null);
      setWorktreeGcError(String(e));
    } finally {
      setWorktreeGcPreviewBusy(false);
    }
  }, [hostRef, worktreeGcForce, worktreeGcOpen]);

  useEffect(() => {
    if (!worktreeGcOpen) return;
    void refreshWorktreeGcPreview();
  }, [worktreeGcOpen, refreshWorktreeGcPreview]);

  const submitWorktreeGc = useCallback(async () => {
    const h = hostRef.current;
    if (!api.isTauri() || !h.activeProject?.path) return;
    setWorktreeGcBusy(true);
    setWorktreeGcError(null);
    try {
      const res = await api.gitWorktreeGc({
        projectPath: h.activeProject.path,
        dryRun: false,
        force: worktreeGcForce,
      });
      const pruned = res.prunedCount ?? res.pruned ?? 0;
      h.showToast(
        pruned > 0
          ? h.tr("composer.worktreeGcDone", { n: String(pruned) })
          : h.tr("composer.worktreeGcDoneNone"),
        4000,
      );
      setWorktreeGcOpen(false);
      setWorktreeGcPreview(null);
      setWorktreeGcForce(false);
      await refreshGitWorktrees();
    } catch (e) {
      setWorktreeGcError(String(e));
    } finally {
      setWorktreeGcBusy(false);
    }
  }, [hostRef, refreshGitWorktrees, worktreeGcForce]);

  const switchToWorktree = useCallback(
    async (wt: api.GitWorktreeEntry) => {
      const h = hostRef.current;
      if (!api.isTauri()) return;
      const path = wt.path?.trim();
      if (!path) return;
      try {
        const existing = h.projects.find((p) => pathsEqual(p.path, path));
        if (existing) {
          await h.bindSessionProject(existing);
          return;
        }
        const trust = !!h.activeProject?.trusted;
        const added = (await api.projectAdd(path, trust)) as Project;
        const list = mapProjectsList((await api.projectsList()) as Project[]);
        h.setProjects(list);
        h.assignNewProjects([added.id]);
        const proj = list.find((p) => p.id === added.id) ?? added;
        if (!proj.trusted) {
          await h.finalizeAddedProject(proj, { bindSession: true });
        } else {
          await h.bindSessionProject(proj);
        }
      } catch (e) {
        h.showToast(String(e), 4500);
      }
    },
    [hostRef],
  );

  const executeWorktreeRemove = useCallback(
    async (wt: api.GitWorktreeEntry, force: boolean) => {
      const h = hostRef.current;
      if (!api.isTauri() || !canRemoveWorktree(wt)) return;
      const mainPath =
        mainWorktreePath(gitWorktrees) || h.activeProject?.path?.trim() || "";
      if (!mainPath) {
        h.showToast(h.tr("composer.worktreeRemoveFailed"), 4000);
        return;
      }
      const wasCurrent = pathsEqual(wt.path, h.activeProject?.path);
      try {
        await api.gitWorktreeRemove({
          projectPath: mainPath,
          worktreePath: wt.path,
          force,
        });
        try {
          const linked = h.sessions.filter(
            (s) =>
              s.isWorktreeSession || pathsEqual(s.worktreePath, wt.path),
          );
          for (const s of linked) {
            if (
              pathsEqual(s.worktreePath, wt.path) ||
              (!s.worktreePath &&
                pathsEqual(
                  h.projects.find((p) => p.id === s.projectId)?.path,
                  wt.path,
                ))
            ) {
              await api.sessionSetWorktree(s.id, {
                worktreePath: null,
                worktreeBranch: null,
              });
            }
          }
          if (linked.length) await h.refreshSessions();
        } catch {
          /* soft-fail */
        }
        if (wasCurrent) {
          const main =
            gitWorktrees.find((w) => w.isMain) ??
            gitWorktrees.find((w) => pathsEqual(w.path, mainPath)) ??
            null;
          if (main) {
            await switchToWorktree(main);
          } else {
            await refreshGitWorktrees();
          }
        } else {
          await refreshGitWorktrees();
        }
      } catch (e) {
        const err = String(e);
        if (!force && worktreeRemoveErrorSuggestsForce(err)) {
          h.setAppDialog({
            kind: "confirm",
            title: h.tr("composer.worktreeRemoveTitle"),
            message: `${h.tr("composer.worktreeRemoveForce")}\n\n${err}`,
            confirmLabel: h.tr("composer.worktreeRemove"),
            danger: true,
            onConfirm: () => {
              void executeWorktreeRemove(wt, true);
            },
          });
          return;
        }
        h.showToast(`${h.tr("composer.worktreeRemoveFailed")}: ${err}`, 5000);
      }
    },
    [gitWorktrees, hostRef, refreshGitWorktrees, switchToWorktree],
  );

  const confirmRemoveWorktree = useCallback(
    (wt: api.GitWorktreeEntry) => {
      const h = hostRef.current;
      if (!canRemoveWorktree(wt)) return;
      const branch = wt.branch?.trim() || h.tr("composer.worktreeDetached");
      const isCurrent = pathsEqual(wt.path, h.activeProject?.path);
      const parts = [
        h.tr("composer.worktreeRemoveHint"),
        h.tr("composer.worktreeRemoveConfirm", {
          branch,
          path: wt.path,
        }),
      ];
      if (isCurrent) {
        parts.push(h.tr("composer.worktreeRemoveCurrentWarn"));
      }
      h.setAppDialog({
        kind: "confirm",
        title: h.tr("composer.worktreeRemoveTitle"),
        message: parts.join("\n\n"),
        confirmLabel: h.tr("composer.worktreeRemove"),
        danger: true,
        onConfirm: () => {
          void executeWorktreeRemove(wt, false);
        },
      });
    },
    [executeWorktreeRemove, hostRef],
  );

  const openWorktreeCreate = useCallback((optsCreate?: { startNewChat?: boolean }) => {
    setWorktreeCreateName("");
    setWorktreeCreateRef("");
    setWorktreeCreateLayout("cli");
    setWorktreeCreateError(null);
    setWorktreeCreateBusy(false);
    setWorktreeCreateStartChat(!!optsCreate?.startNewChat);
    setWorktreeCreateOpen(true);
  }, []);

  let worktreeCreatePreviewPath: string | null = null;
  try {
    const main =
      mainWorktreePath(gitWorktrees) || opts.projectPath || "";
    if (main && worktreeCreateName.trim()) {
      const layout = normalizeWorktreeLayout(worktreeCreateLayout);
      if (layout === "cli" && !cliGrokHome) {
        worktreeCreatePreviewPath = buildWorktreePath(
          "cli",
          main,
          worktreeCreateName.trim(),
          "~/.grok",
        );
      } else {
        worktreeCreatePreviewPath = buildWorktreePath(
          layout,
          main,
          worktreeCreateName.trim(),
          cliGrokHome,
        );
      }
    }
  } catch {
    worktreeCreatePreviewPath = null;
  }

  const markSessionWorktree = useCallback(
    async (
      sessionId: string | null | undefined,
      path: string,
      branch: string | null | undefined,
    ) => {
      const h = hostRef.current;
      if (!sessionId || !api.isTauri()) return;
      const p = path.trim();
      if (!p) return;
      try {
        await api.sessionSetWorktree(sessionId, {
          worktreePath: p,
          worktreeBranch: (branch || "").trim() || null,
        });
        await h.refreshSessions();
      } catch {
        /* soft-fail */
      }
    },
    [hostRef],
  );

  const sessionWorktreeBadgeFor = useCallback(
    (s: SessionRow): SessionWorktreeBadge | null => {
      const h = hostRef.current;
      const proj = s.projectId
        ? (h.projects.find((p) => p.id === s.projectId) ?? null)
        : null;
      return resolveSessionWorktreeBadge(
        {
          worktreePath: s.worktreePath,
          worktreeBranch: s.worktreeBranch,
          isWorktreeSession: s.isWorktreeSession,
        },
        proj?.path ?? s.worktreePath,
        gitWorktrees,
        { grokHome: cliGrokHome },
      );
    },
    [cliGrokHome, gitWorktrees, hostRef],
  );

  const buildSidebarWorktreeBadge = useCallback(
    (s: SessionRow): SidebarSessionWorktreeBadgeProp | null => {
      const h = hostRef.current;
      const wtBadge = sessionWorktreeBadgeFor(s);
      if (!wtBadge) return null;
      const title = sessionWorktreeTooltip(wtBadge, {
        detachedLabel: h.tr("composer.worktreeDetached"),
        cliLayoutLabel: h.tr("session.worktreeLayoutCli"),
        siblingLayoutLabel: h.tr("session.worktreeLayoutSibling"),
        otherLayoutLabel: h.tr("session.worktreeBadge"),
      });
      const ariaKey =
        wtBadge.layoutKind === "cli"
          ? "session.worktreeBadgeCliAria"
          : "session.worktreeBadgeAria";
      return {
        label: wtBadge.label,
        branch: wtBadge.branch,
        layoutKind: wtBadge.layoutKind,
        title,
        ariaLabel: h.tr(ariaKey, {
          branch: wtBadge.branch || h.tr("composer.worktreeDetached"),
        }),
      };
    },
    [hostRef, sessionWorktreeBadgeFor],
  );

  const submitWorktreeCreate = useCallback(async () => {
    const h = hostRef.current;
    if (!api.isTauri() || !h.activeProject?.path) return;
    const rawName = worktreeCreateName.trim();
    if (!rawName) {
      setWorktreeCreateError(h.tr("composer.worktreeNameRequired"));
      return;
    }
    let safeName: string;
    try {
      safeName = sanitizeWorktreeName(rawName);
    } catch {
      setWorktreeCreateError(h.tr("composer.worktreeNameInvalid"));
      return;
    }
    let start: string | null;
    try {
      start = sanitizeWorktreeRef(worktreeCreateRef);
    } catch {
      setWorktreeCreateError(h.tr("composer.worktreeRefInvalid"));
      return;
    }
    const layout = normalizeWorktreeLayout(worktreeCreateLayout);
    setWorktreeCreateBusy(true);
    setWorktreeCreateError(null);
    try {
      const created = await api.gitWorktreeAdd(
        h.activeProject.path,
        safeName,
        start,
        layout,
      );
      setWorktreeCreateOpen(false);
      await refreshGitWorktrees();

      const path = created.path;
      const branch =
        created.branch?.trim() ||
        created.name ||
        h.tr("composer.worktreeDetached");
      const trust = !!h.activeProject.trusted;
      const startChat = worktreeCreateStartChat;
      const existing = h.projects.find((p) => pathsEqual(p.path, path));
      let target: Project | null = existing ?? null;
      if (!target) {
        const added = (await api.projectAdd(path, trust)) as Project;
        const list = mapProjectsList((await api.projectsList()) as Project[]);
        h.setProjects(list);
        h.assignNewProjects([added.id]);
        target = list.find((p) => p.id === added.id) ?? added;
      }

      if (!target.trusted) {
        await h.finalizeAddedProject(target, { bindSession: true });
        return;
      }

      if (startChat) {
        // Materialize session now so worktree meta survives before first send.
        const meta = (await api.sessionCreate(
          target.id,
          h.tr("session.new"),
        )) as SessionRow & { id: string; title?: string };
        await markSessionWorktree(meta.id, path, branch);
        const row = normalizeSessionRow({
          ...meta,
          projectId: target.id,
          worktreePath: path,
          worktreeBranch: branch,
          isWorktreeSession: true,
        });
        h.setExpandedProjects((e) => ({ ...e, [target!.id]: true }));
        await h.openSession(row, target);
      } else {
        await h.bindSessionProject(target);
        const liveId =
          h.viewingSessionIdRef.current || h.session.sessionId || null;
        if (liveId) {
          await markSessionWorktree(liveId, path, branch);
        }
      }
    } catch (e) {
      setWorktreeCreateError(String(e));
    } finally {
      setWorktreeCreateBusy(false);
    }
  }, [
    hostRef,
    markSessionWorktree,
    refreshGitWorktrees,
    worktreeCreateLayout,
    worktreeCreateName,
    worktreeCreateRef,
    worktreeCreateStartChat,
  ]);

  const worktreeChrome: GitWorktreeChromeOverlay = {
    create: {
      open: worktreeCreateOpen,
      busy: worktreeCreateBusy,
      startChat: worktreeCreateStartChat,
      name: worktreeCreateName,
      layout: worktreeCreateLayout,
      startRef: worktreeCreateRef,
      previewPath: worktreeCreatePreviewPath,
      error: worktreeCreateError,
      close: () => setWorktreeCreateOpen(false),
      submit: () => {
        void submitWorktreeCreate();
      },
      setName: (value) => {
        setWorktreeCreateName(value);
        setWorktreeCreateError(null);
      },
      setLayout: (value) => {
        setWorktreeCreateLayout(value);
        setWorktreeCreateError(null);
      },
      setRef: (value) => {
        setWorktreeCreateRef(value);
        setWorktreeCreateError(null);
      },
    },
    gc: {
      open: worktreeGcOpen,
      busy: worktreeGcBusy,
      previewBusy: worktreeGcPreviewBusy,
      force: worktreeGcForce,
      preview: worktreeGcPreview,
      error: worktreeGcError,
      close: () => {
        setWorktreeGcOpen(false);
        setWorktreeGcError(null);
        setWorktreeGcPreview(null);
        setWorktreeGcForce(false);
      },
      submit: () => {
        void submitWorktreeGc();
      },
      setForce: setWorktreeGcForce,
    },
    ship: {
      open: shipOpen,
      busy: shipBusy,
      success: shipSuccess,
      title: shipTitle,
      body: shipBody,
      createPr: shipCreatePr,
      draft: shipDraft,
      branch: shipBranch,
      status: shipStatus,
      error: shipError,
      close: closeShipFlow,
      submit: () => {
        void submitShipFlow();
      },
      setTitle: (value) => {
        setShipTitle(value);
        setShipError(null);
      },
      setBody: (value) => {
        setShipBody(value);
        setShipError(null);
      },
      setCreatePr: setShipCreatePr,
      setDraft: setShipDraft,
      openPrHub: openPrHubFromShip,
    },
  };

  return {
    gitWorktrees,
    gitWorktreesAvailable,
    gitWorktreesLoading,
    gitWorktreesReason,
    cliGrokHome,
    cliWorktrees,
    cliWorktreesAvailable,
    cliWorktreesLoading,
    cliWorktreesReason,
    openWorktreeCreate,
    openWorktreeGc,
    openShipFlow,
    confirmRemoveWorktree,
    switchToWorktree,
    markSessionWorktree,
    sessionWorktreeBadgeFor,
    buildSidebarWorktreeBadge,
    refreshGitWorktrees,
    refreshCliWorktrees,
    applyStatusBranch,
    worktreeChrome,
  };
}
