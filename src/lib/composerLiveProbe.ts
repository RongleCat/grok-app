/**
 * When the composer slash/@ rAF may walk the live DOM.
 * Hidden windows and transcript drag-select must not force layout every frame.
 */

export function shouldProbeComposerLiveDom(opts: {
  visibilityState?: string | null;
  composerActive: boolean;
  selectionInComposer: boolean;
}): boolean {
  if (opts.visibilityState === "hidden") return false;
  return opts.composerActive || opts.selectionInComposer;
}
