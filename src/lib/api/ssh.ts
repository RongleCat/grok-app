/** API domain: SSH remote hosts (Settings → Runtime → SSH). */

import { invoke, isTauri } from "./host";
import type { FsReadResult, FsWriteResult } from "./fs";

export type SshHost = {
  alias: string;
  hostname?: string | null;
  user?: string | null;
  port?: number | null;
  identityFile?: string | null;
};

export type SshListResult = {
  hosts: SshHost[];
  configPath: string;
  configExists: boolean;
  sshFound: boolean;
  error?: string | null;
};

export type SshProbeResult = {
  alias: string;
  ok: boolean;
  sshOk: boolean;
  cli: "ok" | "missing" | "unknown" | string;
  auth: "ok" | "missing" | "unknown" | string;
  cliPath?: string | null;
  cliVersion?: string | null;
  error?: string | null;
  errorCode?: string | null;
  latencyMs?: number | null;
  installCmd: string;
  loginCmd: string;
  installRemoteCmd: string;
  loginRemoteCmd: string;
};

export async function sshListHosts(): Promise<SshListResult> {
  if (!isTauri()) {
    return {
      hosts: [],
      configPath: "",
      configExists: false,
      sshFound: false,
      error: "desktop-only",
    };
  }
  return invoke<SshListResult>("ssh_list_hosts");
}

export async function sshTestHost(alias: string): Promise<SshProbeResult> {
  return invoke<SshProbeResult>("ssh_test_host", { alias });
}

export type SshWatchResult = {
  ok: boolean;
  alias: string;
  watching: boolean;
  error?: string | null;
  errorCode?: string | null;
};

export type SshDirEntry = {
  name: string;
  isDir: boolean;
};

export type SshListDirResult = {
  ok: boolean;
  alias: string;
  path: string;
  entries: SshDirEntry[];
  error?: string | null;
  errorCode?: string | null;
};

export type SshRemoteSession = {
  id: string;
  cwd: string;
  title: string;
  updatedAt?: string | null;
};

export type SshListSessionsResult = {
  ok: boolean;
  alias: string;
  sessions: SshRemoteSession[];
  total?: number | null;
  error?: string | null;
};

export async function sshWatchStart(alias: string) {
  return invoke<SshWatchResult>("ssh_watch_start", { alias });
}

export async function sshWatchStop(alias: string) {
  return invoke<SshWatchResult>("ssh_watch_stop", { alias });
}

export async function sshListDir(alias: string, path?: string | null) {
  return invoke<SshListDirResult>("ssh_list_dir", {
    alias,
    path: path ?? null,
  });
}

export async function sshListSessions(
  alias: string,
  opts?: { offset?: number; limit?: number },
) {
  return invoke<SshListSessionsResult>("ssh_list_sessions", {
    alias,
    offset: opts?.offset ?? 0,
    limit: opts?.limit ?? 20,
  });
}

export type SshOpenSessionResult = {
  ok: boolean;
  alias: string;
  remoteSessionId: string;
  appSessionId?: string | null;
  title?: string | null;
  projectId?: string | null;
  messageCount?: number | null;
  error?: string | null;
};

export async function sshReadFile(
  alias: string,
  projectPath: string,
  relative: string,
) {
  return invoke<FsReadResult>("ssh_read_file", {
    alias,
    projectPath,
    relative,
  });
}

export async function sshWriteFile(
  alias: string,
  projectPath: string,
  relative: string,
  content: string,
  expectedMtimeMs?: number | null,
) {
  return invoke<FsWriteResult>("ssh_write_file", {
    alias,
    projectPath,
    relative,
    content,
    expectedMtimeMs: expectedMtimeMs ?? null,
  });
}

export async function sshOpenSession(
  alias: string,
  sessionId: string,
  opts?: { cwd?: string | null; titleHint?: string | null },
) {
  return invoke<SshOpenSessionResult>("ssh_open_session", {
    alias,
    sessionId,
    cwd: opts?.cwd ?? null,
    titleHint: opts?.titleHint ?? null,
  });
}

export type SshDeleteSessionsResult = {
  ok: boolean;
  alias: string;
  deleted: string[];
  missing?: string[];
  error?: string | null;
};

export async function sshDeleteSessions(alias: string, sessionIds: string[]) {
  return invoke<SshDeleteSessionsResult>("ssh_delete_sessions", {
    alias,
    sessionIds,
  });
}

export type SshBrowserPrepareResult = {
  ok: boolean;
  alias: string;
  url: string;
  displayUrl: string;
  tunneled: boolean;
  localPort?: number | null;
  remoteHost?: string | null;
  remotePort?: number | null;
  error?: string | null;
};

/** Loopback URLs on an SSH project: open via SSH -L, not the local machine. */
export async function sshBrowserPrepare(alias: string, url: string) {
  return invoke<SshBrowserPrepareResult>("ssh_browser_prepare", {
    alias,
    url,
  });
}
