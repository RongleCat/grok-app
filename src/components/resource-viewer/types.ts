/**
 * ResourceViewer shared types — pure types only (no React).
 */

import type { Locale } from "@/i18n";
import type { PlanReviewState } from "@/lib/planBody";
import type { ChatMessage } from "@/lib/session";
import type { SessionFileChange } from "@/lib/sessionChanges";
import type { TasksBindCwdResult } from "@/lib/tasksPanelPro";
import type { AsideLayoutHint } from "@/lib/layout";
import type { BatchDiffPlan } from "@/lib/diffAccept";
import { AGENTS_RAIL_SIDE_MODE } from "@/lib/agentsRail";
import type { FsReadResult } from "@/lib/api";

/** Request from chat (or elsewhere) to open a path/URL in this pane. */
export type ResourceOpenTarget =
  | {
      type: "file";
      path: string;
      title?: string;
      /** 1-based line from path:line citation; soft-fail if out of range. */
      line?: number | null;
      /** Optional 1-based column (passed to open_in_editor when supported). */
      column?: number | null;
    }
  | { type: "url"; url: string; title?: string }
  /** Open the Changes side panel (session + workspace diffs). */
  | { type: "changes"; path?: string };

export interface ResourceViewerProps {
  projectPath: string | null;
  projectName: string | null;
  locale: Locale;
  onClose?: () => void;
  /** When set, open the file/url then call onOpenRequestConsumed. */
  openRequest?: ResourceOpenTarget | null;
  onOpenRequestConsumed?: () => void;
  /**
   * Whether the right pane is currently shown.
   * When it becomes false, the file tree collapses and is not remembered.
   */
  paneActive?: boolean;
  /**
   * Files written/edited by agent tools in the active session (Changes panel).
   */
  sessionChanges?: SessionFileChange[];
  /**
   * Active session messages — drives Resources → Agents task tree.
   */
  sessionMessages?: ChatMessage[];
  /**
   * Bind chat cwd from a subagent worktree path (Agents rail / Tasks panel).
   */
  onOpenAgentsCwd?: (
    cwd: string,
  ) => void | TasksBindCwdResult | Promise<void | TasksBindCwdResult>;
  /** Current chat project path — marks active cwd on Agents rail rows. */
  activeCwd?: string | null;
  /**
   * CLI subagent worktree snapshot mode (`subagent_worktree_snapshot_enabled`).
   */
  subagentWorktreeSnapshotEnabled?: boolean;
  /** Current session is streaming / connecting / awaiting permission. */
  sessionBusy?: boolean;
  /**
   * Live plan snapshot for Plan review mode (exit_plan_mode / progress).
   */
  plan?: PlanReviewState | null;
  /** Increment / change to force switch into Plan mode (详情 / auto-open). */
  planFocusKey?: number | null;
  /**
   * PLAN-MODE-PRO empty-state context (composer mode, settings, hard-dismiss).
   * When omitted, empty panel falls back to the generic planEmpty copy.
   */
  planChrome?: {
    /** Composer access mode (`plan` | `agent` | …). */
    composerMode?: string;
    /** Settings: allow plan mode (false → spawn --no-plan). Default true. */
    planEnabled?: boolean;
    /** User hard-dismissed this plan cycle. */
    userClosed?: boolean;
    /** Local plan history archive is non-empty. */
    hasHistory?: boolean;
  } | null;
  onApprovePlan?: () => void;
  /** Optional revision note when requesting changes (empty allowed). */
  onRequestPlanChanges?: (note?: string) => void;
  onDismissPlan?: () => void;
  /** Open local plan review history archive (session menu / Resources). */
  onOpenPlanHistory?: () => void;
  /**
   * Ship flow from Changes → Workspace (push branch + open PR).
   * Parent opens in-app Ship dialog; never window.confirm.
   */
  onShip?: () => void;
  /**
   * Diff hunk review comment → parent inserts structured prompt into composer
   * (prefer draft insert over auto-send). When omitted, per-hunk Comment is hidden.
   */
  onDiffCommentToChat?: (prompt: string) => void;
  /**
   * Content-aware right-pane layout hint (preview kind, tree open, tabs).
   * App soft-grows aside width so chrome icons never collide with window controls.
   */
  onAsideLayoutHint?: (hint: AsideLayoutHint) => void;
  /**
   * Side Workbench embeds this viewer: hide the top .rp-chrome strip
   * (parent owns shared tabs + expand/side). Keeps split/tree/preview styles.
   */
  embeddedChrome?: boolean;
  /**
   * When embedded, show a second-row files toolbar (breadcrumb + tree + open)
   * matching Codex dual-row chrome under the shared tab strip.
   */
  embeddedFilesToolbar?: boolean;
  /** Controlled tree visibility when embedded (Side Workbench state). */
  treeVisible?: boolean;
  onTreeVisibleChange?: (visible: boolean) => void;
}

export type SideMode = "files" | "changes" | "plan" | typeof AGENTS_RAIL_SIDE_MODE;

export type DiffLayout = "unified" | "split";

export type DiffViewState = {
  path: string;
  name: string;
  loading: boolean;
  /** Unified diff text when available. */
  unified: string | null;
  /** Fallback: full after content only. */
  afterOnly: string | null;
  error: string | null;
  source: "payload" | "git" | "head" | "after" | null;
  /** Snapshots for side-by-side when both sides are known. */
  beforeText?: string | null;
  afterText?: string | null;
};

export type ChangeSelectionSource = "session" | "workspace";

export interface TreeNode {
  name: string;
  relativePath: string;
  isDir: boolean;
  size: number;
  ext: string;
  children?: TreeNode[];
  loaded?: boolean;
}

export interface FileTab {
  id: string;
  relativePath: string;
  name: string;
  absolutePath: string;
  preview: FsReadResult | null;
  mediaSrc: string | null;
  error: string | null;
  loading: boolean;
  /** External URL tab (web page). */
  url?: string;
  tabKind?: "file" | "url";
  /** Editable buffer (text kinds only). */
  draftText?: string | null;
  /** Last loaded/saved text — dirty = draft !== baseline. */
  baselineText?: string | null;
  mtimeMs?: number | null;
  /** true = textarea editor; false = preview (markdown default). */
  editMode?: boolean;
  saving?: boolean;
  /**
   * 1-based focus line from a path:line open request.
   * Soft-fail when out of range (preview ignores).
   */
  focusLine?: number | null;
  /** Optional 1-based column (open_in_editor / future caret). */
  focusColumn?: number | null;
}

export type RejectConfirmState = {
  path: string;
  name: string;
  untracked: boolean;
} | null;

export type BatchRejectConfirmState = {
  plan: BatchDiffPlan;
  untracked: boolean;
} | null;

export type DiffCommentTarget = {
  path: string;
  name: string;
  hunkIndex: number;
  hunkHeader: string;
  hunkSnippet: string;
} | null;

export type BatchProgressState = {
  action: "accept" | "reject";
  current: number;
  total: number;
} | null;

// re-export for consumers that imported AGENTS mode via SideMode
export { AGENTS_RAIL_SIDE_MODE };
