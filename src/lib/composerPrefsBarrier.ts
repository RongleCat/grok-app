/** Serialize a composer preference write so the next send can await it. */
export function queueComposerPreferenceApply(
  previous: Promise<void>,
  apply: () => Promise<unknown>,
  onError: (error: unknown) => void,
): Promise<void> {
  return previous
    .then(apply, apply)
    .then(() => undefined)
    .catch(onError);
}
