/**
 * Persist sidebar Spaces in AppSettings. Mutations stay in the domain module;
 * this hook only hydrates / writes the settings blob.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "@/lib/api";
import {
  assignNewProject,
  createCoalescedFlush,
  createSpace,
  createSpaceAndMoveProject,
  deleteSpace,
  emptyProjectSpacesState,
  filterProjectsBySpace,
  forgetProject,
  moveProjectToSpace,
  parseProjectSpacesState,
  renameSpace,
  revealProjectSpace,
  serializeProjectSpacesState,
  spliceVisibleOrder,
  switchActiveSpace,
  type CreateSpaceError,
  type DeleteSpaceError,
  type ProjectSpacesState,
  type SpaceNameError,
} from "@/lib/projectSpaces";

export type SpaceNameResult =
  | { ok: true; id: string }
  | { ok: false; error: SpaceNameError | CreateSpaceError | "not_found" };
export type SpaceDeleteResult =
  | { ok: true; id: string }
  | { ok: false; error: DeleteSpaceError };

export function useProjectSpaces() {
  const [state, setState] = useState<ProjectSpacesState>(emptyProjectSpacesState);
  const stateRef = useRef(state);
  stateRef.current = state;
  const hydratedRef = useRef(false);
  const dirtyRef = useRef(false);

  const persistNow = useCallback(async () => {
    if (!api.isDesktopHost() && !api.isMirrorClient()) return;
    const blob = serializeProjectSpacesState(stateRef.current);
    const s = await api.settingsGet();
    await api.settingsSet({
      ...s,
      projectSpaces: blob.projectSpaces,
      activeProjectSpaceId: blob.activeProjectSpaceId,
      projectSpaceById: blob.projectSpaceById,
    });
  }, []);

  const flushRef = useRef<{ request: () => void } | null>(null);
  if (!flushRef.current) {
    flushRef.current = createCoalescedFlush(persistNow);
  }

  useEffect(() => {
    if (!api.isDesktopHost() && !api.isMirrorClient()) {
      hydratedRef.current = true;
      return;
    }
    let cancelled = false;
    void api
      .settingsGet()
      .then((s) => {
        if (cancelled) return;
        if (dirtyRef.current) {
          hydratedRef.current = true;
          flushRef.current?.request();
          return;
        }
        const next = parseProjectSpacesState({
          projectSpaces: s.projectSpaces,
          activeProjectSpaceId: s.activeProjectSpaceId,
          projectSpaceById: s.projectSpaceById,
        });
        stateRef.current = next;
        setState(next);
        hydratedRef.current = true;
      })
      .catch(() => {
        hydratedRef.current = true;
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const apply = useCallback((next: ProjectSpacesState) => {
    setState(next);
    stateRef.current = next;
    if (!hydratedRef.current) {
      dirtyRef.current = true;
      return;
    }
    flushRef.current?.request();
  }, []);

  const visibleProjects = useCallback(
    <T extends { id: string }>(projects: readonly T[]): T[] =>
      filterProjectsBySpace(state, projects),
    [state],
  );

  const spliceOrder = useCallback(
    <T extends { id: string }>(all: readonly T[], visibleOrdered: readonly T[]): T[] =>
      spliceVisibleOrder(
        all,
        filterProjectsBySpace(stateRef.current, all).map((p) => p.id),
        visibleOrdered,
      ),
    [],
  );

  return {
    state,
    visibleProjects,
    spliceOrder,
    switchTo: useCallback(
      (id: string) => {
        apply(switchActiveSpace(stateRef.current, id));
      },
      [apply],
    ),
    create: useCallback(
      (name: string): SpaceNameResult => {
        const result = createSpace(stateRef.current, name);
        if (!result.ok) return result;
        apply(result.state);
        return { ok: true, id: result.id };
      },
      [apply],
    ),
    createAndMove: useCallback(
      (projectId: string, name: string): SpaceNameResult => {
        const result = createSpaceAndMoveProject(stateRef.current, name, projectId);
        if (!result.ok) return result;
        apply(result.state);
        return { ok: true, id: result.id };
      },
      [apply],
    ),
    rename: useCallback(
      (id: string, name: string): SpaceNameResult => {
        const result = renameSpace(stateRef.current, id, name);
        if (!result.ok) return result;
        apply(result.state);
        return { ok: true, id: result.id };
      },
      [apply],
    ),
    remove: useCallback(
      (id: string): SpaceDeleteResult => {
        const result = deleteSpace(stateRef.current, id);
        if (!result.ok) return result;
        apply(result.state);
        return { ok: true, id: result.id };
      },
      [apply],
    ),
    moveProject: useCallback(
      (projectId: string, spaceId: string) => {
        apply(moveProjectToSpace(stateRef.current, projectId, spaceId));
      },
      [apply],
    ),
    assignNewProjects: useCallback(
      (projectIds: readonly string[]) => {
        let next = stateRef.current;
        for (const id of projectIds) next = assignNewProject(next, id);
        if (next !== stateRef.current) apply(next);
      },
      [apply],
    ),
    forgetProject: useCallback(
      (projectId: string) => {
        apply(forgetProject(stateRef.current, projectId));
      },
      [apply],
    ),
    revealProject: useCallback(
      (projectId: string) => {
        apply(revealProjectSpace(stateRef.current, projectId));
      },
      [apply],
    ),
  };
}
