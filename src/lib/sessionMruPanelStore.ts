/**
 * Live Ctrl+Tab switcher panel. The nav hook writes; the overlay reads.
 * Kept off AppWorkbench so the shell freeze stays intact.
 */

import type { SessionMruPanelState } from "@/lib/sessionMru";

type Listener = () => void;

let state: SessionMruPanelState = null;
const listeners = new Set<Listener>();
let pickIndex: ((index: number) => void) | null = null;

export function getSessionMruPanelState(): SessionMruPanelState {
  return state;
}

export function setSessionMruPanelState(next: SessionMruPanelState): void {
  state = next;
  for (const listener of listeners) listener();
}

export function subscribeSessionMruPanel(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function registerSessionMruPanelPick(
  fn: ((index: number) => void) | null,
): void {
  pickIndex = fn;
}

export function pickSessionMruPanelIndex(index: number): void {
  pickIndex?.(index);
}
