/**
 * Workbench side of the pet panel's actions (approve / deny / stop / open).
 * Kept out of AppWorkbench so the orchestration shell stays under its gate.
 */
import type { PetQuickActionKind } from "@/lib/api/petQuick";

export type PetQuickActionReq = { kind: PetQuickActionKind; sessionId: string };

const KINDS: readonly PetQuickActionKind[] = ["approve", "deny", "stop", "open"];

/** Pure: sanitize a `pet://quick-action` payload; null when unusable. */
export function parsePetQuickAction(raw: unknown): PetQuickActionReq | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { kind?: unknown; sessionId?: unknown };
  const kind = typeof r.kind === "string" ? (r.kind as PetQuickActionKind) : null;
  const sid = typeof r.sessionId === "string" ? r.sessionId.trim() : "";
  if (!kind || !KINDS.includes(kind) || !sid) return null;
  return { kind, sessionId: sid };
}

type Perm = { sessionId?: string | null };
type Button = { decision: "allow_once" | "allow_session" | "deny"; optionId: string };

export type PetQuickActionDeps<P extends Perm> = {
  /** Active bar payload (current chat) — may be absent from the pending map. */
  activePerm: P | null;
  pendingPerms: ReadonlyMap<string, P>;
  buttonsFor: (p: P) => readonly Button[];
  resolve: (p: P, decision: Button["decision"], optionId: string) => Promise<unknown>;
  stop: (sessionId: string) => Promise<unknown>;
  open: (sessionId: string) => unknown;
  notify: (msg: "none") => void;
};

/** Returns what happened so tests (and logs) can assert it. */
export async function runPetQuickAction<P extends Perm>(
  a: PetQuickActionReq,
  d: PetQuickActionDeps<P>,
): Promise<"approved" | "denied" | "stopped" | "opened" | "no-request"> {
  if (a.kind === "stop") {
    await d.stop(a.sessionId);
    return "stopped";
  }
  if (a.kind === "open") {
    d.open(a.sessionId);
    return "opened";
  }
  const p =
    d.activePerm && d.activePerm.sessionId === a.sessionId
      ? d.activePerm
      : (d.pendingPerms.get(a.sessionId) ?? null);
  const want = a.kind === "approve" ? "allow_once" : "deny";
  const btn = p ? d.buttonsFor(p).find((b) => b.decision === want) : undefined;
  if (!p || !btn) {
    // Nothing waiting (already answered / timed out) — show the chat instead.
    d.notify("none");
    d.open(a.sessionId);
    return "no-request";
  }
  await d.resolve(p, btn.decision, btn.optionId);
  return a.kind === "approve" ? "approved" : "denied";
}
