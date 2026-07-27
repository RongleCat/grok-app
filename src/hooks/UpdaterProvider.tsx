import { createContext, useContext, type ReactNode } from "react";
import { useUpdater } from "./useUpdater";

type UpdaterContextValue = ReturnType<typeof useUpdater>;

const UpdaterContext = createContext<UpdaterContextValue | null>(null);

export function UpdaterProvider({ children }: { children: ReactNode }) {
  const updater = useUpdater();
  return (
    <UpdaterContext.Provider value={updater}>{children}</UpdaterContext.Provider>
  );
}

export function useUpdaterContext(): UpdaterContextValue {
  const ctx = useContext(UpdaterContext);
  if (!ctx) {
    throw new Error("useUpdaterContext must be used within an UpdaterProvider");
  }
  return ctx;
}
