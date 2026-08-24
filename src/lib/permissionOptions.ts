/** Map ACP permission options → UI buttons (once / session / deny). */

export interface AcpPermissionOption {
  optionId?: string;
  option_id?: string;
  id?: string;
  name?: string;
  label?: string;
  kind?: string;
}

/** True when `preview` is the ACP request blob, not a command/path. */
export function isRawPermissionDump(text: string): boolean {
  const t = text.trim();
  if (!t.startsWith("{")) return false;
  return (
    t.includes('"options"') ||
    t.includes('"sessionId"') ||
    t.includes('"toolCall"')
  );
}

/** Strip ACP JSON dumps so the permission bar shows a command, not wire. */
export function displayPermissionPreview(
  preview?: string | null,
): string {
  const t = (preview || "").trim();
  if (!t || isRawPermissionDump(t)) return "";
  return t;
}

export function normalizePermissionOptions(
  options: unknown,
): AcpPermissionOption[] {
  if (Array.isArray(options)) return options as AcpPermissionOption[];
  if (options && typeof options === "object") {
    const inner = (options as { options?: unknown }).options;
    if (Array.isArray(inner)) return inner as AcpPermissionOption[];
  }
  return [];
}

/** Human-readable summary for the permission bar header / aria. */
export function formatPermissionSummary(input: {
  toolName?: string | null;
  title?: string | null;
  path?: string | null;
  command?: string | null;
}): string {
  const tool = (input.toolName || input.title || "").trim();
  const path = (input.path || "").trim();
  const command = displayPermissionPreview(input.command);
  if (command) {
    const short =
      command.length > 96 ? `${command.slice(0, 96)}…` : command;
    return tool ? `${tool}: ${short}` : short;
  }
  if (path) {
    return tool ? `${tool} · ${path}` : path;
  }
  return tool || "Permission request";
}

/** Extra one-line copy that clarifies scope of each decision. */
export function permissionDecisionHint(
  decision: "allow_once" | "allow_session" | "deny",
): string {
  if (decision === "allow_once") {
    return "Run this once; ask again next time.";
  }
  if (decision === "allow_session") {
    return "Allow similar actions for the rest of this chat.";
  }
  return "Block this action and tell the agent.";
}

export interface MappedPermButton {
  decision: "allow_once" | "allow_session" | "deny";
  optionId: string;
  label: string;
}

function oid(o: AcpPermissionOption): string {
  return o.optionId || o.option_id || o.id || "";
}

function kindOf(o: AcpPermissionOption): string {
  return (o.kind || "").toLowerCase();
}

function nameOf(o: AcpPermissionOption): string {
  return (o.name || o.label || "").toLowerCase();
}

export interface PermLabelOverrides {
  allowOnce?: string;
  allowSession?: string;
  deny?: string;
}

/**
 * When ACP options are missing, shell / web_fetch / MCP never accept the
 * generic `always-allow` wire id — only tool-scoped ids. Mirrors Host
 * `fallback_always_allow_for_tool` (#523 / #542 / #544).
 */
export function fallbackSessionOptionId(toolName?: string | null): string {
  const t = (toolName || "").trim().toLowerCase();
  if (
    t.includes("terminal") ||
    t.includes("bash") ||
    t.includes("shell") ||
    t === "execute" ||
    t === "run_terminal_command" ||
    t === "run-terminal-command"
  ) {
    return "allow-always-command";
  }
  if (
    t.includes("web_fetch") ||
    t.includes("webfetch") ||
    t.includes("web-fetch") ||
    t === "fetch"
  ) {
    return "allow-always-domain";
  }
  if (
    t.includes("mcp") ||
    t === "use_tool" ||
    t === "use-tool" ||
    t.startsWith("mcp_") ||
    t.startsWith("mcp-")
  ) {
    return "allow-always-mcp";
  }
  if (
    t.includes("write") ||
    t.includes("edit") ||
    t.includes("replace") ||
    t.includes("image") ||
    t === "read_file" ||
    t === "read-file"
  ) {
    return "allow-always";
  }
  return "always-allow";
}

/** Prefer real Agent optionIds; fall back to kind heuristics. */
export function mapPermissionButtons(
  options: unknown,
  labels?: PermLabelOverrides,
  /** Real tool name when options list is empty (#542 / #544). */
  toolName?: string | null,
): MappedPermButton[] {
  const arr: AcpPermissionOption[] = normalizePermissionOptions(options);

  const find = (pred: (o: AcpPermissionOption) => boolean) => arr.find(pred);

  const idOf = (o: AcpPermissionOption) => oid(o).toLowerCase();

  const once =
    find((o) => kindOf(o) === "allow_once") ||
    find((o) => idOf(o) === "allow-once" || idOf(o) === "allow_once") ||
    find((o) => nameOf(o).includes("once") && nameOf(o).includes("allow")) ||
    find((o) => kindOf(o).includes("allow") && !kindOf(o).includes("always"));

  // Session allow: kind allow_always / allow_always_bash, or CLI wire ids
  // always-allow / allow-always-command|mcp|domain (#523 + shell follow-up).
  const always =
    find(
      (o) =>
        kindOf(o) === "allow_always" ||
        kindOf(o).startsWith("allow_always") ||
        kindOf(o).startsWith("allow-always"),
    ) ||
    find((o) => {
      const id = idOf(o);
      return (
        id === "always-allow" ||
        id === "allow-always" ||
        id === "allow_always" ||
        id.startsWith("allow-always-") ||
        id.startsWith("allow_always_")
      );
    }) ||
    find((o) => {
      const n = nameOf(o);
      if (n.includes("reject") || n.includes("deny")) return false;
      return (
        (n.includes("allow") && n.includes("always")) ||
        (n.includes("allow") && n.includes("session")) ||
        (n.includes("don't ask again") && n.includes("bash")) ||
        (n.includes("dont ask again") && n.includes("bash"))
      );
    });

  const reject =
    find((o) => kindOf(o) === "reject_once" || kindOf(o) === "reject_always") ||
    find(
      (o) =>
        idOf(o) === "reject-once" ||
        idOf(o) === "reject-always" ||
        idOf(o) === "reject",
    ) ||
    find((o) => nameOf(o).includes("reject") || nameOf(o).includes("deny"));

  const L = {
    allowOnce: labels?.allowOnce ?? "Allow once",
    allowSession: labels?.allowSession ?? "Allow for session",
    deny: labels?.deny ?? "Deny",
  };

  // Always show short i18n labels (agent option names are often long English).
  // optionId still comes from the real ACP option when present.
  // CLI wire ids are hyphenated (`allow-once`, `always-allow`, `reject-once`);
  // underscore fallbacks are rejected as "unknown permission option" (#523).
  const out: MappedPermButton[] = [];
  if (once && oid(once)) {
    out.push({
      decision: "allow_once",
      optionId: oid(once),
      label: L.allowOnce,
    });
  } else {
    out.push({
      decision: "allow_once",
      optionId: "allow-once",
      label: L.allowOnce,
    });
  }
  // Map "Allow for session" to allow_always kind when present (session scope in our Host).
  // CLI generic session id is `always-allow` (word order reversed from allow-always-*).
  // Empty options + shell → `allow-always-command` so CLI does not cancel the turn (#544).
  if (always && oid(always)) {
    out.push({
      decision: "allow_session",
      optionId: oid(always),
      label: L.allowSession,
    });
  } else if (arr.length > 0 && once && oid(once)) {
    // #600: listed tools without a session-scoped option (write/edit)
    // still show "Allow for session" (Host caches scope) but the wire
    // id must be a published option — inventing always-allow cancels.
    out.push({
      decision: "allow_session",
      optionId: oid(once),
      label: L.allowSession,
    });
  } else {
    out.push({
      decision: "allow_session",
      optionId: fallbackSessionOptionId(toolName),
      label: L.allowSession,
    });
  }
  if (reject && oid(reject)) {
    out.push({
      decision: "deny",
      optionId: oid(reject),
      label: L.deny,
    });
  } else {
    out.push({ decision: "deny", optionId: "reject-once", label: L.deny });
  }
  return out;
}
