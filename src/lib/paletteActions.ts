/**
 * Command-palette quick actions — pure catalog + filter.
 * UI (App search panel) maps ids to existing openers (settings hash, doctor, etc.).
 */

import type { MessageKey } from "@/i18n";

export type PaletteActionDef = {
  /** Stable id used by the host to dispatch (e.g. `settings-general`). */
  id: string;
  /** i18n key for the row label. */
  labelKey: MessageKey;
  /** English (and optional alias) tokens for free-text match. */
  keywords: string[];
  /** Optional UI group hint (host may ignore). */
  group?: string;
};

/** Full default catalog — only actions that already exist in App. */
export function defaultPaletteActions(): PaletteActionDef[] {
  return [
    {
      id: "new-chat",
      labelKey: "search.newChat",
      keywords: ["new", "chat", "conversation", "session", "compose"],
      group: "create",
    },
    {
      id: "add-project",
      labelKey: "sidebar.addProject",
      keywords: ["add", "project", "folder", "open folder", "workspace"],
      group: "create",
    },
    {
      id: "new-space",
      labelKey: "sidebar.spaces.new",
      keywords: [
        "space",
        "spaces",
        "workspace",
        "work space",
        "personal",
        "new space",
        "空间",
        "空間",
      ],
      group: "create",
    },
    {
      id: "open-automations",
      labelKey: "automations.title",
      keywords: [
        "automations",
        "scheduled",
        "schedule",
        "cron",
        "tasks list",
        "recurring",
      ],
      group: "navigate",
    },
    {
      id: "open-ops",
      labelKey: "ops.palette",
      keywords: [
        "ops",
        "operations",
        "agent ops",
        "fleet",
        "运维",
        "操作台",
        "任务中心",
      ],
      group: "ops",
    },
    {
      id: "open-tasks",
      labelKey: "tasks.showPanel",
      keywords: [
        "tasks",
        "agent tasks",
        "tools panel",
        "activity",
        "running tools",
        "ops",
        "工具面板",
      ],
      group: "ops",
    },
    {
      id: "open-agent-dashboard",
      labelKey: "dashboard.open",
      keywords: [
        "dashboard",
        "agent dashboard",
        "sessions",
        "multi session",
        "busy sessions",
        "stop all",
        "activity monitor",
        "cross session",
        "ops",
        "fleet",
      ],
      group: "ops",
    },
    {
      id: "open-task-board",
      labelKey: "taskBoard.open",
      keywords: [
        "task board",
        "session board",
        "kanban",
        "columns",
        "needs you",
        "running",
        "idle",
        "done",
        "board view",
        "status board",
        "ops",
        "看板",
        "任务板",
      ],
      group: "ops",
    },
    {
      id: "open-kanban",
      labelKey: "kanban.open",
      keywords: [
        "kanban",
        "agent kanban",
        "agents",
        "agent dashboard",
        "needs you",
        "working",
        "done",
        "fleet",
        "worktree",
        "agent map",
        "看板",
        "智能体",
        "仪表盘",
      ],
      group: "ops",
    },
    {
      id: "open-batch-agents",
      labelKey: "batchAgents.open",
      keywords: [
        "batch",
        "batch agents",
        "multi project",
        "multi-project",
        "dispatch",
        "fan out",
        "headless",
        "same prompt",
        "ops",
        "批量",
        "多项目",
      ],
      group: "ops",
    },
    {
      id: "doctor",
      labelKey: "doctor.title",
      keywords: ["doctor", "diagnostics", "health", "cli check", "troubleshoot"],
      group: "diagnose",
    },
    {
      id: "traces",
      labelKey: "session.traces",
      keywords: [
        "trace",
        "traces",
        "session trace",
        "grok trace",
        "export history",
        "diagnostic archive",
      ],
      group: "diagnose",
    },
    {
      id: "reliability",
      labelKey: "reliability.title",
      keywords: [
        "reliability",
        "observability",
        "busy sessions",
        "stall",
        "error deck",
        "support zip",
        "diagnostics",
        "long task",
      ],
      group: "diagnose",
    },
    {
      id: "shortcuts-help",
      labelKey: "shortcuts.help",
      keywords: ["shortcuts", "keyboard", "hotkeys", "keymap", "help", "?"],
      group: "help",
    },
    {
      id: "product-tutorial",
      labelKey: "tutorial.menu",
      keywords: [
        "tutorial",
        "product tour",
        "tour",
        "onboarding",
        "walkthrough",
        "guide",
        "help",
      ],
      group: "help",
    },
    {
      id: "copy-conversation-md",
      labelKey: "session.copyMd",
      keywords: [
        "copy",
        "conversation",
        "markdown",
        "md",
        "clipboard",
        "export text",
        "copy chat",
        "copy session",
        "copy thread",
      ],
      group: "session",
    },
    {
      id: "resume-with-code-restore",
      labelKey: "session.resumeRestore",
      keywords: [
        "resume",
        "continue",
        "restore",
        "restore code",
        "code restore",
        "worktree",
        "clean worktree",
        "isolate",
        "git restore",
      ],
      group: "session",
    },
    {
      id: "continue-cwd",
      labelKey: "project.continueCwd",
      keywords: [
        "continue",
        "continue last",
        "continue last agent",
        "continue session",
        "most recent",
        "last agent",
        "last session",
        "cwd",
        "this project",
        "-c",
        "--continue",
        "resume project",
        "resume last",
      ],
      group: "session",
    },
    {
      id: "parallel-worktree-task",
      labelKey: "composer.parallelTask",
      keywords: [
        "parallel",
        "parallel task",
        "worktree",
        "new worktree",
        "worktree chat",
        "isolate",
        "branch task",
        "git worktree",
        "side task",
        "parallel chat",
      ],
      group: "create",
    },
    {
      id: "settings-general",
      labelKey: "settings.nav.general",
      keywords: ["settings", "general", "preferences", "prefs", "composer"],
      group: "settings",
    },
    {
      id: "settings-appearance",
      labelKey: "settings.nav.appearance",
      keywords: [
        "settings",
        "appearance",
        "theme",
        "dark",
        "light",
        "wallpaper",
        "skin",
      ],
      group: "settings",
    },
    {
      id: "settings-account",
      labelKey: "settings.nav.account",
      keywords: [
        "settings",
        "account",
        "login",
        "providers",
        "api key",
        "auth",
      ],
      group: "settings",
    },
    {
      id: "settings-extensions",
      labelKey: "settings.nav.extensions",
      keywords: [
        "settings",
        "extensions",
        "plugins",
        "skills",
        "mcp",
        "hooks",
        "marketplace",
      ],
      group: "settings",
    },
    {
      id: "settings-runtime",
      labelKey: "settings.nav.runtime",
      keywords: [
        "settings",
        "runtime",
        "cli",
        "connection",
        "network",
        "pool",
        "tools",
      ],
      group: "settings",
    },
    {
      id: "settings-workflows",
      labelKey: "settings.workflows",
      keywords: [
        "workflows",
        "workflow",
        "rhai",
        "workflows_enabled",
        "create-workflow",
        "/workflows",
        "/workflow",
        "orchestration",
        "工作流",
      ],
      group: "settings",
    },
    {
      id: "workflows-docs",
      labelKey: "settings.workflows.openDocs",
      keywords: [
        "workflows docs",
        "workflow docs",
        "create-workflow",
        "rhai docs",
        "open workflows",
        "工作流文档",
      ],
      group: "help",
    },
    {
      id: "settings-remote",
      labelKey: "settings.nav.remoteIm",
      keywords: [
        "settings",
        "remote",
        "remote control",
        "im",
        "mirror",
        "phone",
        "feishu",
        "telegram",
      ],
      group: "settings",
    },
    {
      id: "settings-shortcuts",
      labelKey: "settings.nav.shortcuts",
      keywords: ["settings", "keyboard", "shortcuts", "hotkeys", "bindings"],
      group: "settings",
    },
    {
      id: "settings-about",
      labelKey: "settings.nav.about",
      keywords: ["settings", "about", "version", "update", "license"],
      group: "settings",
    },
  ];
}

/**
 * Filter palette actions by free-text query.
 * - Empty query → all actions (optionally capped by `limit`).
 * - Non-empty → match id, keywords, and translated label (when `t` is provided).
 */
export function filterPaletteActions(
  query: string,
  actions: readonly PaletteActionDef[],
  t?: (key: MessageKey) => string,
  opts?: { limit?: number },
): PaletteActionDef[] {
  const limit = opts?.limit ?? 50;
  const q = query.trim().toLowerCase();
  if (!q) return actions.slice(0, limit);

  const hits: PaletteActionDef[] = [];
  for (const action of actions) {
    if (hits.length >= limit) break;
    if (matchesPaletteAction(action, q, t)) hits.push(action);
  }
  return hits;
}

function matchesPaletteAction(
  action: PaletteActionDef,
  q: string,
  t?: (key: MessageKey) => string,
): boolean {
  const hay: string[] = [
    action.id.toLowerCase(),
    action.labelKey.toLowerCase(),
    ...action.keywords.map((k) => k.toLowerCase()),
  ];
  if (t) hay.push(t(action.labelKey).toLowerCase());

  // Full-string substring (handles "settings-general", single keywords, labels).
  if (hay.some((h) => h.includes(q))) return true;

  // Multi-word: every token must hit somewhere (e.g. "New Chat" → new + chat).
  const tokens = q.split(/[\s/_-]+/).filter(Boolean);
  if (tokens.length > 1) {
    return tokens.every((tok) => hay.some((h) => h.includes(tok)));
  }
  return false;
}
