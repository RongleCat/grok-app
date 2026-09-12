/**
 * Multi-root workspace modal state (#1194 MVP-0).
 * Keep out of AppWorkbench — pass thin callbacks only.
 */

import { useCallback, useEffect, useState } from "react";
import * as api from "@/lib/api";
import type { WorkspaceRecord, WorkspaceRoot } from "@/lib/multiRootWorkspace";
import {
  MAX_EXTRA_WORKSPACE_ROOTS,
  extraRoots,
  primaryRoot,
} from "@/lib/multiRootWorkspace";

export type MultiRootWorkspaceTarget = {
  projectId: string;
  projectName: string;
  projectPath: string;
  sessionId: string | null;
  workspaceId: string | null;
};

export function useMultiRootWorkspace() {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<MultiRootWorkspaceTarget | null>(null);
  const [draft, setDraft] = useState<WorkspaceRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    setTarget(null);
    setDraft(null);
    setError(null);
    setBusy(false);
  }, []);

  const openFor = useCallback(async (next: MultiRootWorkspaceTarget) => {
    setTarget(next);
    setOpen(true);
    setError(null);
    setBusy(true);
    try {
      let ws: WorkspaceRecord | null = null;
      if (next.workspaceId) {
        ws = (await api.workspaceGet(next.workspaceId)) ?? null;
      }
      if (!ws) {
        const list = await api.workspacesForProject(next.projectId);
        ws = list[0] ?? null;
      }
      if (!ws) {
        ws = {
          id: "",
          name: `${next.projectName} workspace`,
          primaryProjectId: next.projectId,
          roots: [
            {
              path: next.projectPath,
              role: "primary",
              access: "write",
              pathOk: true,
            },
          ],
          capability: "contextOnly",
          updatedAt: new Date().toISOString(),
        };
      }
      setDraft(ws);
    } catch (e) {
      setError(String(e));
      setDraft(null);
    } finally {
      setBusy(false);
    }
  }, []);

  const addExtraRoot = useCallback(async () => {
    if (!draft) return;
    if (extraRoots(draft).length >= MAX_EXTRA_WORKSPACE_ROOTS) {
      setError(`max ${MAX_EXTRA_WORKSPACE_ROOTS}`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const picked = await api.pickDirectory();
      if (!picked) return;
      const validated = await api.workspaceValidateRoot(picked);
      const path = validated.path;
      if (draft.roots.some((r) => r.path === path)) {
        setError("duplicate");
        return;
      }
      setDraft({
        ...draft,
        roots: [
          ...draft.roots,
          {
            path,
            role: "extra",
            access: "read",
            pathOk: validated.pathOk ?? true,
          },
        ],
      });
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, [draft]);

  const removeExtraRoot = useCallback(
    (path: string) => {
      if (!draft) return;
      setDraft({
        ...draft,
        roots: draft.roots.filter(
          (r) => !(r.role === "extra" && r.path === path),
        ),
      });
    },
    [draft],
  );

  const save = useCallback(async () => {
    if (!draft || !target) return null;
    setBusy(true);
    setError(null);
    try {
      const roots: WorkspaceRoot[] = draft.roots.map((r) =>
        r.role === "extra" ? { ...r, access: "read" } : r,
      );
      const saved = await api.workspaceUpsert({
        id: draft.id || null,
        name: draft.name,
        primaryProjectId: target.projectId,
        roots,
      });
      if (target.sessionId) {
        await api.sessionSetWorkspace(target.sessionId, saved.id);
      }
      try {
        await api.settingsSet({ recentWorkspaceId: saved.id });
      } catch {
        /* soft */
      }
      setDraft(saved);
      return saved;
    } catch (e) {
      setError(String(e));
      return null;
    } finally {
      setBusy(false);
    }
  }, [draft, target]);

  const clearBinding = useCallback(async () => {
    if (!target?.sessionId) return;
    setBusy(true);
    try {
      await api.sessionSetWorkspace(target.sessionId, null);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, [target]);

  useEffect(() => {
    if (!open) return;
    // Keep primary path label fresh when target changes.
    if (draft && target && primaryRoot(draft)?.path !== target.projectPath) {
      /* leave user edits alone */
    }
  }, [open, draft, target]);

  return {
    open,
    target,
    draft,
    setDraft,
    busy,
    error,
    openFor,
    close,
    addExtraRoot,
    removeExtraRoot,
    save,
    clearBinding,
  };
}
