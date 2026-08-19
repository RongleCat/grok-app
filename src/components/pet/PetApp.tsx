/**
 * Slim pet overlay root — does not boot the workbench.
 */
import { useEffect, useState } from "react";
import { listen } from "@/lib/api/host";
import {
  petGetFocus,
  petGetTasks,
  petPrefsGet,
  petWebviewReady,
  readPetBootPrefs,
  PET_OVERLAY_POLICY_FULL,
  type PetOverlayPolicy,
  type PetPrefs,
} from "@/lib/api/pet";
import {
  fallbackPetOverlayPolicy,
  type PetFocus,
  type PetTask,
} from "@/lib/pet";
import { resolveLocale, type Locale } from "@/i18n";
import { settingsGet } from "@/lib/api/settings";
import { PetOverlay } from "./PetOverlay";
import "@/styles/pet.css";

const IDLE: PetFocus = {
  kind: "idle",
  sessionId: null,
  title: null,
  toolTitle: null,
  rank: 5,
  updatedAt: 0,
};

function readLocale(): Locale {
  try {
    return resolveLocale(document.documentElement.lang);
  } catch {
    return "en";
  }
}

export function PetApp() {
  const [focus, setFocus] = useState<PetFocus>(IDLE);
  const [tasks, setTasks] = useState<PetTask[]>([]);
  const [prefs, setPrefs] = useState<PetPrefs>(readPetBootPrefs);
  const [locale, setLocale] = useState<Locale>(readLocale);
  const [policy, setPolicy] = useState<PetOverlayPolicy>(PET_OVERLAY_POLICY_FULL);

  useEffect(() => {
    document.documentElement.setAttribute("data-pet-shell", "1");
    document.body.style.background = "transparent";
    document.querySelector(".boot-gate")?.setAttribute("hidden", "");
    let gone = false;
    void petWebviewReady()
      .then((p) => {
        if (!gone) {
          setPolicy(
            p ??
              fallbackPetOverlayPolicy(
                typeof navigator !== "undefined" ? navigator.userAgent : "",
              ),
          );
        }
      })
      .catch(() => {
        if (!gone) {
          setPolicy(
            fallbackPetOverlayPolicy(
              typeof navigator !== "undefined" ? navigator.userAgent : "",
            ),
          );
        }
      });
    return () => {
      gone = true;
      document.documentElement.removeAttribute("data-pet-shell");
    };
  }, []);

  useEffect(() => {
    let gone = false;
    void petPrefsGet().then((p) => {
      if (!gone) setPrefs(p);
    });
    void petGetFocus().then((f) => {
      if (!gone && f) setFocus(f);
    });
    void petGetTasks().then((rows) => {
      if (!gone) setTasks(rows);
    });
    const unsubs: Array<() => void> = [];
    void listen<PetFocus>("pet://focus", (f) => {
      if (f?.kind) setFocus(f);
    }).then((u) => unsubs.push(u));
    void listen<PetTask[]>("pet://tasks", (rows) => {
      if (Array.isArray(rows)) setTasks(rows);
    }).then((u) => unsubs.push(u));
    void listen<PetPrefs>("pet://prefs", (p) => {
      if (p) setPrefs(p);
    }).then((u) => unsubs.push(u));
    return () => {
      gone = true;
      for (const u of unsubs) u();
    };
  }, []);

  useEffect(() => {
    let gone = false;
    void settingsGet()
      .then((s) => {
        if (!gone) setLocale(resolveLocale(s.locale));
      })
      .catch(() => {
        if (!gone) setLocale(readLocale());
      });
    return () => {
      gone = true;
    };
  }, []);

  return (
    <PetOverlay
      focus={focus}
      tasks={tasks}
      prefs={prefs}
      locale={locale}
      policy={policy}
    />
  );
}
