/** API domain: multi-root workspace (#1194) */

import { invoke } from "./host";
import type { WorkspaceRecord, WorkspaceRoot } from "@/lib/multiRootWorkspace";

export type { WorkspaceRecord, WorkspaceRoot };

export async function workspacesList() {
  return invoke<WorkspaceRecord[]>("workspaces_list");
}

export async function workspacesForProject(projectId: string) {
  return invoke<WorkspaceRecord[]>("workspaces_for_project", { projectId });
}

export async function workspaceGet(id: string) {
  return invoke<WorkspaceRecord | null>("workspace_get", { id });
}

export async function workspaceUpsert(input: {
  id?: string | null;
  name: string;
  primaryProjectId: string;
  roots: WorkspaceRoot[];
}) {
  return invoke<WorkspaceRecord>("workspace_upsert", {
    id: input.id ?? null,
    name: input.name,
    primaryProjectId: input.primaryProjectId,
    roots: input.roots,
  });
}

export async function workspaceDelete(id: string) {
  return invoke<void>("workspace_delete", { id });
}

export async function workspaceValidateRoot(path: string) {
  return invoke<WorkspaceRoot>("workspace_validate_root", { path });
}

export async function sessionSetWorkspace(
  id: string,
  workspaceId: string | null,
) {
  return invoke("session_set_workspace", {
    id,
    workspaceId,
  });
}
