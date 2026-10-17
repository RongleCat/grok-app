/**
 * Pet quick bar → workbench: open (or start) the target chat, then send
 * without raising the window. Hidden WebView2 throttles rAF, so the settle
 * wait uses a timer.
 */
import type { PetQuickPrompt } from "@/lib/api/petQuick";

type Row = { id: string; projectId?: string | null };
type Proj = { id: string };

export type PetQuickPromptDeps<R extends Row, P extends Proj, L> = {
  sessions: readonly R[];
  projects: readonly P[];
  openSession: (row: R, proj: P | null) => Promise<unknown>;
  newChat: () => Promise<unknown>;
  sessionsList: () => Promise<L[]>;
  mapRow: (raw: L) => R;
  send: (o: {
    storedDisplay: string;
    att: [];
    goalMode: false;
    targetSessionId: string | null;
  }) => Promise<boolean>;
  showToast: (msg: string, ms?: number) => void;
  tr: (key: "pet.quick.sendFailedToast") => string;
  settleMs?: number;
};

export async function runPetQuickPrompt<R extends Row, P extends Proj, L>(
  p: PetQuickPrompt,
  d: PetQuickPromptDeps<R, P, L>,
): Promise<boolean> {
  let target: string | null = null;
  if (p.sessionId) {
    let row = d.sessions.find((s) => s.id === p.sessionId) ?? null;
    if (!row) {
      try {
        const hit = (await d.sessionsList())
          .map(d.mapRow)
          .find((s) => s.id === p.sessionId);
        if (hit) row = hit;
      } catch {
        /* fall through to a new chat */
      }
    }
    if (row) {
      const proj = d.projects.find((pr) => pr.id === row!.projectId) ?? null;
      await d.openSession(row, proj);
      target = row.id;
    }
  }
  if (!target) await d.newChat();
  await new Promise((r) => setTimeout(r, d.settleMs ?? 60));
  const ok = await d.send({
    storedDisplay: p.text,
    att: [],
    goalMode: false,
    targetSessionId: target,
  });
  if (!ok) d.showToast(d.tr("pet.quick.sendFailedToast"), 4200);
  return ok;
}
