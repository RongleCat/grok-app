/** Multi-root workspace helpers (#1194 MVP-0). */

export const MAX_EXTRA_WORKSPACE_ROOTS = 8;

export type WorkspaceRootRole = "primary" | "extra";
export type WorkspaceRootAccess = "read" | "write";

export type WorkspaceCapability =
  | "none"
  | "contextOnly"
  | "enforcedRead"
  | "extraWriteActive"
  | "blocked";

export type WorkspaceRoot = {
  path: string;
  role: WorkspaceRootRole;
  access: WorkspaceRootAccess;
  pathOk?: boolean | null;
};

export type WorkspaceRecord = {
  id: string;
  name: string;
  primaryProjectId: string;
  roots: WorkspaceRoot[];
  profileRef?: string | null;
  capability: WorkspaceCapability;
  updatedAt: string;
};

export function extraRoots(ws: WorkspaceRecord | null | undefined): WorkspaceRoot[] {
  return (ws?.roots ?? []).filter((r) => r.role === "extra");
}

export function primaryRoot(ws: WorkspaceRecord | null | undefined): WorkspaceRoot | null {
  return (ws?.roots ?? []).find((r) => r.role === "primary") ?? null;
}

export function workspaceChipLabel(
  ws: WorkspaceRecord | null | undefined,
  projectName: string,
): string {
  if (!ws) return projectName;
  const n = extraRoots(ws).length;
  if (n <= 0) return projectName;
  return `${projectName} +${n}`;
}

/** MVP-0: capability banner always honest about whole-disk read. */
export function isCrossRootWriteAllowed(
  capability: WorkspaceCapability | string | null | undefined,
): boolean {
  return capability === "extraWriteActive" || capability === "extra_write_active";
}

export function normalizeCapability(
  raw: string | null | undefined,
): WorkspaceCapability {
  switch ((raw ?? "").trim()) {
    case "none":
      return "none";
    case "enforcedRead":
    case "enforced_read":
      return "enforcedRead";
    case "extraWriteActive":
    case "extra_write_active":
      return "extraWriteActive";
    case "blocked":
      return "blocked";
    case "contextOnly":
    case "context_only":
    default:
      return "contextOnly";
  }
}
