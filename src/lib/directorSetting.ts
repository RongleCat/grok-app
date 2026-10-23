/**
 * App-wide Director mode. Off until Settings turns it on.
 * The composer reads this on each send. Session spawn reads the same flag
 * from app settings and attaches it as ACP `_meta.rules`.
 */
import { useSyncExternalStore } from "react";

type Listener = () => void;

let enabled = false;
const listeners = new Set<Listener>();

export function directorSettingEnabled(): boolean {
  return enabled;
}

export function setDirectorSettingEnabled(on: boolean): void {
  if (enabled === on) return;
  enabled = on;
  for (const listener of listeners) listener();
}

export function subscribeDirectorSetting(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useDirectorSettingEnabled(): boolean {
  return useSyncExternalStore(
    subscribeDirectorSetting,
    directorSettingEnabled,
    directorSettingEnabled,
  );
}
