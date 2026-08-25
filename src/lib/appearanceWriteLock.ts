/**
 * Process-wide appearance write lock (FE).
 *
 * Shared by SkinShareProvider Apply/Save and Settings wallpaper upload /
 * WallpaperSourceModal / focus editor so IDB + localStorage cannot split-brain.
 */

type Unlock = () => void;

let tail: Promise<void> = Promise.resolve();
let holders = 0;
const listeners = new Set<(busy: boolean) => void>();

function emit(): void {
  const busy = holders > 0;
  for (const fn of listeners) fn(busy);
}

export function isAppearanceWriteBusy(): boolean {
  return holders > 0;
}

export function subscribeAppearanceWriteBusy(
  fn: (busy: boolean) => void,
): () => void {
  listeners.add(fn);
  fn(holders > 0);
  return () => {
    listeners.delete(fn);
  };
}

export function acquireAppearanceWrite(): Promise<Unlock> {
  let release!: () => void;
  const mine = new Promise<void>((resolve) => {
    release = resolve;
  });
  const wait = tail;
  tail = tail.then(() => mine);
  return wait.then(() => {
    holders += 1;
    emit();
    let unlocked = false;
    return () => {
      if (unlocked) return;
      unlocked = true;
      holders = Math.max(0, holders - 1);
      emit();
      release();
    };
  });
}
