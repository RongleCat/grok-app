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
import {
  htmlLangForLocale,
  loadLocaleCatalog,
  parseLocalePreference,
  resolveLocale,
  resolveLocalePreference,
  type Locale,
} from "@/i18n";
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

function readBootLocale(): Locale {
  try {
    const w = window as Window & { __GROK_BOOT_LOCALE__?: string };
    if (typeof w.__GROK_BOOT_LOCALE__ === "string" && w.__GROK_BOOT_LOCALE__.trim()) {
      return resolveLocale(w.__GROK_BOOT_LOCALE__);
    }
    return resolveLocale(document.documentElement.lang);
  } catch {
    return "en";
  }
}

export function PetApp() {
  const [focus, setFocus] = useState<PetFocus>(IDLE);
  const [tasks, setTasks] = useState<PetTask[]>([]);
  const [prefs, setPrefs] = useState<PetPrefs>(readPetBootPrefs);
  const [locale, setLocale] = useState<Locale>(readBootLocale);
  const [localeCatalogRev, setLocaleCatalogRev] = useState(0);
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
    void loadLocaleCatalog(locale).then(() => {
      if (!gone) setLocaleCatalogRev((n) => n + 1);
    });
    document.documentElement.setAttribute("lang", htmlLangForLocale(locale));
    return () => {
      gone = true;
    };
  }, [locale]);

  useEffect(() => {
    let gone = false;
    void settingsGet()
      .then((s) => {
        if (!gone) {
          setLocale(resolveLocalePreference(parseLocalePreference(s.locale)));
        }
      })
      .catch(() => {
        if (!gone) setLocale(readBootLocale());
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
      localeCatalogRev={localeCatalogRev}
      policy={policy}
    />
  );
}
