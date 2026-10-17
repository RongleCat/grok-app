/** Pet overlay hash — used by the slim `#/pet` webview. */
export function isPetShellHash(hash: string | null | undefined): boolean {
  const h = (hash ?? "").trim();
  return h === "#/pet" || h.startsWith("#/pet?");
}

/** Pet quick bar hash — the slim `#/pet-quick` prompt window. */
export function isPetQuickHash(hash: string | null | undefined): boolean {
  const h = (hash ?? "").trim();
  return h === "#/pet-quick" || h.startsWith("#/pet-quick?");
}
