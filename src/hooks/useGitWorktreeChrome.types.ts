import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { createT } from "@/i18n";
import * as api from "@/lib/api";
import type { AppDialog } from "@/lib/app/appDialogTypes";
import type { Project, SessionRow } from "@/lib/app/sidebarModels";
import type { WorktreeLayout } from "@/lib/gitWorktree";
import type { SettingsSectionId } from "@/lib/settingsCatalog";

type TFn = ReturnType<typeof createT>;

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
