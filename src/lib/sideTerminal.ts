/**
 * Side Workbench terminal spawn helpers — user $SHELL as login+interactive.
 * Pure: no DOM / Tauri side effects.
 */

export type TerminalSpawnPlan = {
  /** Absolute path to the shell binary (or shell name). */
  shell: string;
  /** Args for login + interactive (e.g. ["-l", "-i"]). */
  args: string[];
  /** Working directory: project path when present, else home. */
  cwd: string;
  /** True when SHELL came from the environment. */
  fromEnv: boolean;
};

/** Where the resolved spawn cwd came from. */
export type TerminalCwdSource = "project" | "home" | "dot";

export type TerminalCwdResolve = {
  /** Path the shell should start in (or did start in when `boundCwd` known). */
  cwd: string;
  source: TerminalCwdSource;
  /** Trimmed project path when provided (may differ from `cwd` on fallback). */
  requestedProject: string | null;
};

/**
 * Normalize a filesystem path for cwd comparison.
 * Collapses trailing slashes (except roots), unifies separators.
 */
export function normalizeTerminalCwd(
  path: string | null | undefined,
): string {
  let s = (path ?? "").trim();
  if (!s) return "";
  s = s.replace(/\\/g, "/");
  // Keep Windows drive root `C:/` and POSIX `/`.
  if (/^[A-Za-z]:\/$/.test(s) || s === "/") return s;
  // Drop trailing slashes on normal paths.
  s = s.replace(/\/+$/, "");
  return s;
}

/** Case-fold on Windows-style drive paths; otherwise exact after normalize. */
export function terminalCwdsEqual(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const na = normalizeTerminalCwd(a);
  const nb = normalizeTerminalCwd(b);
  if (!na || !nb) return na === nb;
  const aWin = /^[A-Za-z]:\//.test(na);
  const bWin = /^[A-Za-z]:\//.test(nb);
  if (aWin || bWin) return na.toLowerCase() === nb.toLowerCase();
  return na === nb;
}

/**
 * Resolve intended spawn cwd for a terminal tab.
 * Prefer project when non-empty; else home; else `.`.
 * Does not probe the filesystem (host may still fall back).
 */
export function resolveTerminalCwd(opts: {
  projectPath?: string | null;
  home?: string | null;
  env?: Record<string, string | undefined> | NodeJS.ProcessEnv;
}): TerminalCwdResolve {
  // When `env` is passed explicitly, do not fall through to process.env
  // (keeps unit tests deterministic).
  const env =
    opts.env ?? (typeof process !== "undefined" ? process.env : {});
  const project = (opts.projectPath || "").trim() || null;
  const homeRaw = (
    opts.home ||
    env.HOME ||
    env.USERPROFILE ||
    ""
  ).trim();
  if (project) {
    return { cwd: project, source: "project", requestedProject: project };
  }
  if (homeRaw) {
    return { cwd: homeRaw, source: "home", requestedProject: null };
  }
  return { cwd: ".", source: "dot", requestedProject: null };
}

/**
 * After host spawn: classify whether bound cwd matches the requested project.
 * Host may fall back to HOME when the project path is missing/not a dir.
 */
export function classifyTerminalSpawnCwd(opts: {
  projectPath?: string | null;
  boundCwd?: string | null;
  home?: string | null;
  env?: Record<string, string | undefined> | NodeJS.ProcessEnv;
}): {
  kind: "matched_project" | "no_project_home" | "project_fallback" | "matched_other";
  intended: TerminalCwdResolve;
  boundCwd: string;
} {
  const intended = resolveTerminalCwd(opts);
  const bound = normalizeTerminalCwd(opts.boundCwd) || intended.cwd;
  if (intended.source === "project") {
    if (terminalCwdsEqual(bound, intended.cwd)) {
      return { kind: "matched_project", intended, boundCwd: bound };
    }
    return { kind: "project_fallback", intended, boundCwd: bound };
  }
  if (intended.source === "home" || intended.source === "dot") {
    return { kind: "no_project_home", intended, boundCwd: bound };
  }
  return { kind: "matched_other", intended, boundCwd: bound };
}

/** Live-session honesty when the active project changes under a bound PTY. */
export type TerminalCwdHonestyKind =
  | "none"
  | "host_only"
  | "no_project"
  | "project_fallback"
  | "project_mismatch"
  | "session_ended"
  | "spawn_failed";

export type TerminalCwdHonesty = {
  kind: TerminalCwdHonestyKind;
  /** i18n message key (empty when kind is none). */
  messageKey: string;
  boundCwd?: string;
  desiredCwd?: string;
  /** Short technical detail for spawn_failed (never invent secrets). */
  detail?: string;
};

const HONESTY_KEYS: Record<
  Exclude<TerminalCwdHonestyKind, "none">,
  string
> = {
  host_only: "side.terminal.hostOnly",
  no_project: "side.terminal.cwd.noProject",
  project_fallback: "side.terminal.cwd.projectFallback",
  project_mismatch: "side.terminal.cwd.projectMismatch",
  session_ended: "side.terminal.sessionEnded",
  spawn_failed: "side.terminal.spawnFailed",
};

/**
 * Classify empty / mismatch honesty for the terminal tab chrome.
 * Priority: host_only → spawn_failed → session_ended → project_fallback
 * → project_mismatch → no_project → none.
 *
 * Live PTY cannot chdir when the project switches — surface mismatch instead
 * of silently killing the shell (caller restarts on explicit user action).
 */
export function classifyTerminalCwdHonesty(input: {
  isTauri?: boolean | null;
  projectPath?: string | null;
  boundCwd?: string | null;
  home?: string | null;
  sessionEnded?: boolean;
  exitCode?: number | null;
  spawnError?: string | null;
  /** Host reported bound cwd after spawn (enables fallback detection). */
  spawnClassified?: ReturnType<typeof classifyTerminalSpawnCwd> | null;
  ready?: boolean;
}): TerminalCwdHonesty {
  if (input.isTauri === false) {
    return { kind: "host_only", messageKey: HONESTY_KEYS.host_only };
  }
  const err = (input.spawnError || "").trim();
  if (err) {
    return {
      kind: "spawn_failed",
      messageKey: HONESTY_KEYS.spawn_failed,
      detail: err.length < 240 ? err : err.slice(0, 237) + "…",
    };
  }
  if (input.sessionEnded) {
    return {
      kind: "session_ended",
      messageKey: HONESTY_KEYS.session_ended,
      boundCwd: normalizeTerminalCwd(input.boundCwd) || undefined,
    };
  }

  const bound = normalizeTerminalCwd(input.boundCwd);
  const desired = resolveTerminalCwd({
    projectPath: input.projectPath,
    home: input.home,
  });

  if (input.spawnClassified?.kind === "project_fallback") {
    return {
      kind: "project_fallback",
      messageKey: HONESTY_KEYS.project_fallback,
      boundCwd: input.spawnClassified.boundCwd,
      desiredCwd: input.spawnClassified.intended.cwd,
    };
  }

  // Live session: project changed under an already-bound PTY.
  if (
    input.ready &&
    bound &&
    desired.source === "project" &&
    !terminalCwdsEqual(bound, desired.cwd)
  ) {
    return {
      kind: "project_mismatch",
      messageKey: HONESTY_KEYS.project_mismatch,
      boundCwd: bound,
      desiredCwd: desired.cwd,
    };
  }

  if (desired.source !== "project" && (input.ready || bound)) {
    return {
      kind: "no_project",
      messageKey: HONESTY_KEYS.no_project,
      boundCwd: bound || desired.cwd,
      desiredCwd: desired.cwd,
    };
  }

  return { kind: "none", messageKey: "" };
}

/** Soft-fail classification for spawn/host errors (UI copy). */
export function classifyTerminalSpawnError(err: unknown): {
  kind: "host_only" | "spawn_failed";
  messageKey: string;
  detail: string;
} {
  const raw =
    err == null
      ? ""
      : typeof err === "string"
        ? err
        : err instanceof Error
          ? err.message
          : String(err);
  const t = raw.trim();
  if (/not\s+tauri|desktop\s+app|host\s+only|no\s+window/i.test(t)) {
    return {
      kind: "host_only",
      messageKey: HONESTY_KEYS.host_only,
      detail: "",
    };
  }
  return {
    kind: "spawn_failed",
    messageKey: HONESTY_KEYS.spawn_failed,
    detail: t.length < 240 ? t : t.slice(0, 237) + "…",
  };
}

/**
 * Resolve the user's login shell and cwd for an embedded terminal tab.
 * Prefer `env.SHELL`; fall back to `/bin/zsh` (mac) or `/bin/bash`.
 */
export function resolveTerminalSpawnPlan(opts: {
  env?: Record<string, string | undefined> | NodeJS.ProcessEnv;
  projectPath?: string | null;
  home?: string | null;
  platform?: string;
}): TerminalSpawnPlan {
  const env = opts.env ?? (typeof process !== "undefined" ? process.env : {});
  const shellRaw = (env.SHELL || "").trim();
  const fromEnv = !!shellRaw;
  let shell = shellRaw;
  if (!shell) {
    const plat = (opts.platform || "").toLowerCase();
    // Note: "darwin" contains "win" — match win32/windows only.
    const isWin =
      /\bwin/.test(plat) || plat === "win32" || plat.startsWith("windows");
    shell = isWin
      ? "powershell.exe"
      : plat.includes("linux")
        ? "/bin/bash"
        : "/bin/zsh";
  }

  const cwdResolve = resolveTerminalCwd({
    projectPath: opts.projectPath,
    home: opts.home,
    env,
  });
  const cwd = cwdResolve.cwd;

  // login (-l) + interactive (-i) so rc / oh-my-zsh load.
  // Windows PowerShell does not use -l/-i; keep empty args.
  const isWindows =
    shell.toLowerCase().includes("powershell") ||
    shell.toLowerCase().endsWith("cmd.exe");
  const args = isWindows ? [] : ["-l", "-i"];

  return { shell, args, cwd, fromEnv };
}

/** Command line string for diagnostics / logging (no secrets). */
export function formatTerminalCommand(plan: TerminalSpawnPlan): string {
  const parts = [plan.shell, ...plan.args];
  return parts.join(" ");
}
