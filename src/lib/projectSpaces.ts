/**
 * Sidebar Spaces — named buckets of projects.
 *
 * A Space is a UI grouping (Work / Personal / …). It is not a git workspace
 * and not the general agent cwd. Existing installs stay on the "All projects"
 * view until the user creates or switches a space.
 */

export const DEFAULT_SPACE_ID = "space:default";
export const ALL_SPACES_ID = "all";

export const MAX_SPACES = 20;
export const MAX_SPACE_NAME_LEN = 40;

export type ProjectSpace = {
  id: string;
  name: string;
};

export type ProjectSpacesState = {
  spaces: ProjectSpace[];
  /** `all` or a space id. `all` is a view, never a membership target. */
  activeId: string;
  /** projectId → spaceId. Missing / unknown → default space. */
  membership: Record<string, string>;
};

export type SpaceNameError = "empty" | "duplicate" | "too_long";
export type CreateSpaceError = SpaceNameError | "limit";
export type DeleteSpaceError = "not_found" | "last" | "default";

export type SpaceMutation<E extends string> =
  | { ok: true; state: ProjectSpacesState; id: string }
  | { ok: false; error: E };

export type ProjectSpacesPersist = {
  projectSpaces: ProjectSpace[];
  activeProjectSpaceId: string | null;
  projectSpaceById: Record<string, string>;
};

export function emptyProjectSpacesState(): ProjectSpacesState {
  return {
    spaces: [{ id: DEFAULT_SPACE_ID, name: "" }],
    activeId: ALL_SPACES_ID,
    membership: {},
  };
}

function defaultSpace(): ProjectSpace {
  return { id: DEFAULT_SPACE_ID, name: "" };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function normalizeName(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

function nameKey(name: string): string {
  return name.toLocaleLowerCase();
}

export function isAllSpacesView(id: string | null | undefined): boolean {
  const v = (id || "").trim();
  return !v || v === ALL_SPACES_ID;
}

export function isDefaultSpaceId(id: string | null | undefined): boolean {
  return (id || "").trim() === DEFAULT_SPACE_ID;
}

export function findSpace(
  state: ProjectSpacesState,
  id: string,
): ProjectSpace | undefined {
  return state.spaces.find((s) => s.id === id);
}

export function spaceDisplayName(
  space: ProjectSpace | null | undefined,
  defaultLabel: string,
): string {
  const name = (space?.name || "").trim();
  if (name) return name;
  if (space && isDefaultSpaceId(space.id)) return defaultLabel;
  return defaultLabel;
}

/** Label for the sidebar section head. All-view keeps the generic "Projects". */
export function activeSpaceLabel(
  state: ProjectSpacesState,
  labels: { all: string; default: string; projects: string },
): string {
  if (isAllSpacesView(state.activeId)) return labels.projects;
  const space = findSpace(state, state.activeId);
  if (!space) return labels.projects;
  return spaceDisplayName(space, labels.default);
}

export function spaceOfProject(
  state: ProjectSpacesState,
  projectId: string,
): string {
  const mapped = state.membership[projectId];
  if (mapped && findSpace(state, mapped)) return mapped;
  return DEFAULT_SPACE_ID;
}

export function filterProjectsBySpace<T extends { id: string }>(
  state: ProjectSpacesState,
  projects: readonly T[],
): T[] {
  if (isAllSpacesView(state.activeId)) return projects.slice();
  const spaceId = findSpace(state, state.activeId)
    ? state.activeId
    : DEFAULT_SPACE_ID;
  return projects.filter((p) => spaceOfProject(state, p.id) === spaceId);
}

export function countProjectsInSpace(
  state: ProjectSpacesState,
  spaceId: string,
  projectIds: readonly string[],
): number {
  if (isAllSpacesView(spaceId)) return projectIds.length;
  return projectIds.filter((id) => spaceOfProject(state, id) === spaceId)
    .length;
}

function ensureDefaultSpace(spaces: ProjectSpace[]): ProjectSpace[] {
  if (spaces.some((s) => s.id === DEFAULT_SPACE_ID)) return spaces;
  return [defaultSpace(), ...spaces];
}

function sanitizeSpaces(raw: unknown): ProjectSpace[] {
  if (!Array.isArray(raw)) return [defaultSpace()];
  const out: ProjectSpace[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const id = typeof item.id === "string" ? item.id.trim() : "";
    if (!id || id === ALL_SPACES_ID || seen.has(id)) continue;
    const name =
      typeof item.name === "string"
        ? item.name.replace(/\s+/g, " ").trim().slice(0, MAX_SPACE_NAME_LEN)
        : "";
    seen.add(id);
    out.push({ id, name });
    if (out.length >= MAX_SPACES) break;
  }
  return ensureDefaultSpace(out);
}

function sanitizeMembership(
  raw: unknown,
  spaces: readonly ProjectSpace[],
): Record<string, string> {
  if (!isRecord(raw)) return {};
  const known = new Set(spaces.map((s) => s.id));
  const out: Record<string, string> = {};
  for (const [projectId, spaceId] of Object.entries(raw)) {
    const pid = String(projectId || "").trim();
    const sid = typeof spaceId === "string" ? spaceId.trim() : "";
    if (!pid || !sid || sid === ALL_SPACES_ID) continue;
    if (!known.has(sid) || sid === DEFAULT_SPACE_ID) continue;
    out[pid] = sid;
  }
  return out;
}

export function parseProjectSpacesState(
  raw: Partial<ProjectSpacesPersist> | null | undefined,
): ProjectSpacesState {
  const spaces = sanitizeSpaces(raw?.projectSpaces);
  const membership = sanitizeMembership(raw?.projectSpaceById, spaces);
  const activeRaw =
    typeof raw?.activeProjectSpaceId === "string"
      ? raw.activeProjectSpaceId.trim()
      : "";
  const activeId =
    !activeRaw || activeRaw === ALL_SPACES_ID
      ? ALL_SPACES_ID
      : spaces.some((s) => s.id === activeRaw)
        ? activeRaw
        : ALL_SPACES_ID;
  return { spaces, activeId, membership };
}

export function serializeProjectSpacesState(
  state: ProjectSpacesState,
): ProjectSpacesPersist {
  const spaces = ensureDefaultSpace(
    state.spaces
      .filter((s) => s.id && s.id !== ALL_SPACES_ID)
      .slice(0, MAX_SPACES)
      .map((s) => ({
        id: s.id,
        name: s.name.trim().slice(0, MAX_SPACE_NAME_LEN),
      })),
  );
  const membership = sanitizeMembership(state.membership, spaces);
  const activeId = isAllSpacesView(state.activeId)
    ? ALL_SPACES_ID
    : spaces.some((s) => s.id === state.activeId)
      ? state.activeId
      : ALL_SPACES_ID;
  return {
    projectSpaces: spaces,
    activeProjectSpaceId: activeId,
    projectSpaceById: membership,
  };
}

export function switchActiveSpace(
  state: ProjectSpacesState,
  id: string,
): ProjectSpacesState {
  const next = (id || "").trim();
  if (isAllSpacesView(next)) {
    if (state.activeId === ALL_SPACES_ID) return state;
    return { ...state, activeId: ALL_SPACES_ID };
  }
  if (!findSpace(state, next)) return state;
  if (state.activeId === next) return state;
  return { ...state, activeId: next };
}

function validateName(
  state: ProjectSpacesState,
  raw: string,
  exceptId?: string,
): { ok: true; name: string } | { ok: false; error: SpaceNameError } {
  const name = normalizeName(raw);
  if (!name) return { ok: false, error: "empty" };
  if (name.length > MAX_SPACE_NAME_LEN) return { ok: false, error: "too_long" };
  const key = nameKey(name);
  const clash = state.spaces.some((s) => {
    if (exceptId && s.id === exceptId) return false;
    const existing = (s.name || "").trim();
    return existing ? nameKey(existing) === key : false;
  });
  if (clash) return { ok: false, error: "duplicate" };
  return { ok: true, name };
}

function newSpaceId(): string {
  const uuid =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `space:${uuid}`;
}

export function createSpace(
  state: ProjectSpacesState,
  rawName: string,
  opts?: { id?: string },
): SpaceMutation<CreateSpaceError> {
  if (state.spaces.length >= MAX_SPACES) {
    return { ok: false, error: "limit" };
  }
  const checked = validateName(state, rawName);
  if (!checked.ok) return checked;
  let id = (opts?.id || "").trim();
  if (!id || id === ALL_SPACES_ID || findSpace(state, id)) {
    id = newSpaceId();
  }
  const space: ProjectSpace = { id, name: checked.name };
  return {
    ok: true,
    id,
    state: {
      spaces: [...state.spaces, space],
      activeId: id,
      membership: state.membership,
    },
  };
}

export function renameSpace(
  state: ProjectSpacesState,
  id: string,
  rawName: string,
): SpaceMutation<SpaceNameError | "not_found"> {
  const space = findSpace(state, id);
  if (!space) return { ok: false, error: "not_found" };
  const checked = validateName(state, rawName, id);
  if (!checked.ok) return checked;
  if (space.name === checked.name) {
    return { ok: true, id, state };
  }
  return {
    ok: true,
    id,
    state: {
      ...state,
      spaces: state.spaces.map((s) =>
        s.id === id ? { ...s, name: checked.name } : s,
      ),
    },
  };
}

export function deleteSpace(
  state: ProjectSpacesState,
  id: string,
): SpaceMutation<DeleteSpaceError> {
  if (isDefaultSpaceId(id)) return { ok: false, error: "default" };
  if (!findSpace(state, id)) return { ok: false, error: "not_found" };
  if (state.spaces.length <= 1) return { ok: false, error: "last" };
  const membership: Record<string, string> = {};
  for (const [projectId, spaceId] of Object.entries(state.membership)) {
    if (spaceId !== id) membership[projectId] = spaceId;
  }
  const activeId =
    state.activeId === id ? ALL_SPACES_ID : state.activeId;
  return {
    ok: true,
    id,
    state: {
      spaces: state.spaces.filter((s) => s.id !== id),
      activeId,
      membership,
    },
  };
}

/** Create a space and assign a project in one state update (one persist). */
export function createSpaceAndMoveProject(
  state: ProjectSpacesState,
  rawName: string,
  projectId: string,
  opts?: { id?: string },
): SpaceMutation<CreateSpaceError> {
  const created = createSpace(state, rawName, opts);
  if (!created.ok) return created;
  return {
    ok: true,
    id: created.id,
    state: moveProjectToSpace(created.state, projectId, created.id),
  };
}

export function moveProjectToSpace(
  state: ProjectSpacesState,
  projectId: string,
  spaceId: string,
): ProjectSpacesState {
  const pid = (projectId || "").trim();
  if (!pid) return state;
  const sid = isAllSpacesView(spaceId) ? DEFAULT_SPACE_ID : spaceId.trim();
  if (!findSpace(state, sid)) return state;
  const current = spaceOfProject(state, pid);
  if (current === sid) {
    if (sid === DEFAULT_SPACE_ID && !(pid in state.membership)) return state;
    if (sid !== DEFAULT_SPACE_ID && state.membership[pid] === sid) return state;
  }
  const membership = { ...state.membership };
  if (sid === DEFAULT_SPACE_ID) delete membership[pid];
  else membership[pid] = sid;
  return { ...state, membership };
}

/** New project lands in the current named space, or Default when viewing All. */
export function assignNewProject(
  state: ProjectSpacesState,
  projectId: string,
): ProjectSpacesState {
  const pid = (projectId || "").trim();
  if (!pid) return state;
  const target = isAllSpacesView(state.activeId)
    ? DEFAULT_SPACE_ID
    : findSpace(state, state.activeId)
      ? state.activeId
      : DEFAULT_SPACE_ID;
  return moveProjectToSpace(state, pid, target);
}

export function forgetProject(
  state: ProjectSpacesState,
  projectId: string,
): ProjectSpacesState {
  const pid = (projectId || "").trim();
  if (!pid || !(pid in state.membership)) return state;
  const membership = { ...state.membership };
  delete membership[pid];
  return { ...state, membership };
}

/** True when the current view hides this project (All already shows everything). */
export function shouldRevealProjectSpace(
  state: ProjectSpacesState,
  projectId: string,
): boolean {
  if (isAllSpacesView(state.activeId)) return false;
  return spaceOfProject(state, projectId) !== state.activeId;
}

/** Switch to the owning space only when the current view hides the project. */
export function revealProjectSpace(
  state: ProjectSpacesState,
  projectId: string,
): ProjectSpacesState {
  if (!shouldRevealProjectSpace(state, projectId)) return state;
  return switchActiveSpace(state, spaceOfProject(state, projectId));
}

/** Serialize overlapping persist calls so only the latest snapshot is written. */
export function createCoalescedFlush(flush: () => Promise<void>): {
  request: () => void;
} {
  let pending = false;
  let inflight = false;
  const api = {
    request() {
      pending = true;
      if (inflight) return;
      inflight = true;
      void (async () => {
        try {
          while (pending) {
            pending = false;
            await flush();
          }
        } finally {
          inflight = false;
        }
        if (pending) api.request();
      })();
    },
  };
  return api;
}

/**
 * Reorder only the visible (current-space) projects, keeping other projects
 * in their existing slots so a Work-space drag cannot shove Personal rows.
 */
export function spliceVisibleOrder<T extends { id: string }>(
  all: readonly T[],
  visibleIds: readonly string[],
  visibleOrdered: readonly T[],
): T[] {
  const slots = new Set(visibleIds);
  const queue = visibleOrdered.filter((p) => slots.has(p.id));
  let i = 0;
  const next: T[] = [];
  for (const item of all) {
    if (!slots.has(item.id)) {
      next.push(item);
      continue;
    }
    const take = queue[i];
    i += 1;
    next.push(take ?? item);
  }
  return next;
}
