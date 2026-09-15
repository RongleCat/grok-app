/**
 * Host-side “send this work to a new task”: a short brief, not a full fork.
 */

import type { ChatMessage } from "./session/types";
import { isTurnPromptMessage } from "./session/types";

const FILE_PATH_RE =
  /(?:^|[\s`'"(])((?:~|\/|[A-Za-z]:[\\/])[^\s`'"]+\.[A-Za-z0-9]{1,8})/g;

function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

function lastOf(
  messages: readonly ChatMessage[],
  pred: (m: ChatMessage) => boolean,
): ChatMessage | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && pred(m)) return m;
  }
  return null;
}

export function collectHandoffFilePaths(
  messages: readonly ChatMessage[],
  limit = 8,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string) => {
    const p = raw.trim();
    if (!p || seen.has(p)) return;
    seen.add(p);
    out.push(p);
  };
  for (const m of messages) {
    for (const a of m.attachments ?? []) {
      if (a.path) push(a.path);
    }
    const text = `${m.content ?? ""}\n${m.toolPath ?? ""}`;
    FILE_PATH_RE.lastIndex = 0;
    let hit: RegExpExecArray | null;
    while ((hit = FILE_PATH_RE.exec(text))) {
      if (hit[1]) push(hit[1]);
      if (out.length >= limit) return out;
    }
    if (out.length >= limit) return out;
  }
  return out.slice(0, limit);
}

export function handoffSessionTitle(sourceTitle: string | null | undefined): string {
  const base = (sourceTitle || "").trim() || "chat";
  if (/^task of\b/i.test(base)) return base;
  return `Task of ${base}`;
}

/** Short sibling-session brief: goal / done / leftover / key files. */
export function buildHandoffBrief(input: {
  title?: string | null;
  parentSessionId?: string | null;
  messages: readonly ChatMessage[];
}): string {
  const title = (input.title || "").trim() || "untitled chat";
  const users = input.messages.filter((m) => isTurnPromptMessage(m));
  const lastUser = users[users.length - 1] ?? null;
  const firstUser = users[0] ?? null;
  const lastAssistant = lastOf(
    input.messages,
    (m) => m.role === "assistant" && !m.isError && !!(m.content || "").trim(),
  );
  const leftoverUsers = users.slice(0, -1).slice(-2);
  const files = collectHandoffFilePaths(input.messages);

  const lines: string[] = [
    `Handoff from parent chat “${title}”.`,
    "Continue this leftover work in this new session. Do not re-greet.",
    "",
    "## Goal",
    clip(lastUser?.content || firstUser?.content || "(not stated)", 400),
    "",
    "## Done",
    clip(lastAssistant?.content || "(no assistant reply yet)", 500),
  ];
  if (leftoverUsers.length) {
    lines.push("", "## Leftover");
    for (const u of leftoverUsers) {
      lines.push(`- ${clip(u.content || "", 160)}`);
    }
  }
  if (files.length) {
    lines.push("", "## Key files");
    for (const f of files) lines.push(`- \`${f}\``);
  }
  const pid = input.parentSessionId?.trim();
  if (pid) {
    lines.push("", `Parent session id: \`${pid}\``);
  }
  return lines.join("\n").trim() + "\n";
}
