/**
 * SSH directory listing vs files-pane error banner.
 *
 * Opening a path chip lists every ancestor, then reads the file. Listing a
 * file (or a missing parent) is not an SSH outage — the file can still load.
 * Nested list failures must not paint "failed" over a successful preview.
 */

export type SshListDirHonestyInput = {
  ok: boolean;
  error?: string | null;
  errorCode?: string | null;
};

const QUIET_LIST_CODES = new Set(["not_a_dir", "cd_fail"]);

export function sshListDirIsQuietFailure(
  result: SshListDirHonestyInput,
): boolean {
  if (result.ok) return false;
  const code = (result.errorCode || "").trim().toLowerCase();
  return QUIET_LIST_CODES.has(code);
}

/**
 * Only the project-root listing may set the pane error bar.
 * Nested expand (path-chip ancestors) stays silent.
 */
export function sshListDirShouldSetPaneError(input: {
  relative: string;
  result: SshListDirHonestyInput;
}): boolean {
  if (input.result.ok) return false;
  if (sshListDirIsQuietFailure(input.result)) return false;
  return !(input.relative || "").trim();
}
