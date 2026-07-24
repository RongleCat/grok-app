/**
 * Project folder path health (D05).
 * Backend sets `pathOk` on list by re-checking `is_dir` — never invent it in the UI.
 */

/** True when Host reported the project path is missing / not a directory. */
export function isProjectPathMissing(
  pathOk: boolean | undefined | null,
): boolean {
  return pathOk === false;
}
