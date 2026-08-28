/**
 * Resolve a chat path token against an SSH project cwd.
 * Never uses local std::fs — list the remote parent (or the path itself).
 */

import {
  joinRemoteRelative,
  normalizeRemoteCwd,
} from "@/lib/sshRemoteSessionDisplay";
import { isPathUnderProject, normalizeSidePath } from "@/lib/sidePathDeepLink";

export type SshChatPathHit = {
  abs: string;
  relative: string;
  isDir: boolean;
};

export function sshChatAbsCandidate(
  projectPath: string,
  token: string,
): string | null {
  const root = normalizeRemoteCwd(projectPath);
  const raw = (token || "").trim().replace(/\\/g, "/");
  if (!root || !raw) return null;
  if (raw.startsWith("/")) {
    const abs = normalizeSidePath(raw) || raw.replace(/\/+$/, "");
    if (!isPathUnderProject(root, abs)) return null;
    return abs;
  }
  try {
    return joinRemoteRelative(root, raw);
  } catch {
    return null;
  }
}

export function sshChatRelative(projectPath: string, abs: string): string {
  const root = normalizeRemoteCwd(projectPath);
  const n = normalizeRemoteCwd(abs);
  if (!root || n === root) return "";
  if (n.startsWith(`${root}/`)) return n.slice(root.length + 1);
  return "";
}

/**
 * Absolute remote directory to list. Relative segments join the project root.
 * Never throws — invalid `..` returns null.
 */
export function sshRemoteDirToList(
  projectPath: string,
  relative: string,
): string | null {
  const root = normalizeRemoteCwd(projectPath);
  if (!root) return null;
  const rel = (relative || "").trim().replace(/\\/g, "/");
  if (!rel || rel === ".") return root;
  if (rel.startsWith("/")) {
    const n = normalizeRemoteCwd(rel);
    if (n === root || n.startsWith(`${root}/`)) return n;
    return null;
  }
  try {
    return joinRemoteRelative(root, rel);
  } catch {
    return null;
  }
}

export type SshListDirLike = (alias: string, path?: string | null) => Promise<{
  ok: boolean;
  entries?: { name: string; isDir?: boolean }[] | null;
}>;

export async function resolveSshChatPath(
  alias: string,
  projectPath: string,
  token: string,
  listDir: SshListDirLike,
): Promise<SshChatPathHit | null> {
  const abs = sshChatAbsCandidate(projectPath, token);
  if (!abs) return null;
  const listing = await listDir(alias, abs);
  if (listing.ok) {
    return {
      abs,
      relative: sshChatRelative(projectPath, abs),
      isDir: true,
    };
  }
  const slash = abs.lastIndexOf("/");
  const parent = slash <= 0 ? "/" : abs.slice(0, slash);
  const name = slash < 0 ? abs : abs.slice(slash + 1);
  if (!name) return null;
  const parentList = await listDir(alias, parent);
  if (!parentList.ok) return null;
  const hit = (parentList.entries || []).find((e) => e.name === name);
  if (!hit) return null;
  return {
    abs,
    relative: sshChatRelative(projectPath, abs),
    isDir: !!hit.isDir,
  };
}
