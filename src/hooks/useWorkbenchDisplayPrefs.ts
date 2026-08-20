/**
 * Workbench display + composer chrome preferences (localStorage + Settings events).
 * Extracted from AppWorkbench (P2) so the shell does not own every pref listener.
 */
import { useEffect, useRef, useState } from "react";
import {
  loadAskUserTimeoutSec,
  ASK_USER_TIMEOUT_CHANGE_EVENT,
} from "@/lib/askUserTimeout";
import {
  loadComposerSendKeyPref,
  COMPOSER_SEND_KEY_CHANGED_EVENT,
  type ComposerSendKeyPref,
} from "@/lib/composerSendKey";
import {
  loadComposerSpellcheck,
  COMPOSER_SPELLCHECK_CHANGED_EVENT,
} from "@/lib/composerSpellcheck";
import {
  loadComposerDraftStatsPref,
  COMPOSER_DRAFT_STATS_CHANGED_EVENT,
} from "@/lib/draftStats";
import {
  loadGoalOrchUiEnabled,
  type GoalOrchEvent,
} from "@/lib/goalOrch";
import {
  loadMessageTimestampsPref,
  MESSAGE_TIMESTAMPS_CHANGE_EVENT,
} from "@/lib/messageTimestampsPref";
import {
  loadShowReplyLengthPref,
  SHOW_REPLY_LENGTH_CHANGE_EVENT,
} from "@/lib/messageLength";
import {
  loadMessageTimeFormatPref,
  MESSAGE_TIME_FORMAT_CHANGE_EVENT,
  type MessageTimeFormat,
} from "@/lib/messageTimeFormatPref";
import {
  loadNotifySoundPref,
  NOTIFY_SOUND_CHANGE_EVENT,
} from "@/lib/notifySound";
import {
  loadPermissionTimeoutSec,
  PERMISSION_TIMEOUT_CHANGE_EVENT,
} from "@/lib/permissionTimeout";
import {
  loadReplaceProviderBrandLogoPref,
  REPLACE_PROVIDER_BRAND_LOGO_CHANGE_EVENT,
} from "@/lib/replaceProviderBrandLogoPref";
import {
  loadSidebarDensity,
  SIDEBAR_DENSITY_EVENT,
  type SidebarDensity,
} from "@/lib/sidebarDensity";
import {
  loadSidebarShowRelativeTimePref,
  SIDEBAR_SHOW_RELATIVE_TIME_CHANGE_EVENT,
} from "@/lib/sidebarShowRelativeTimePref";
import {
  loadTrayBusyBadgePref,
} from "@/lib/trayBusyBadgePref";
import {
  applyWindowAlwaysOnTop,
  loadWindowAlwaysOnTopPref,
} from "@/lib/windowAlwaysOnTop";

/**
 * Callers pass inline arrows, so subscribing on their identity would re-bind
 * every workbench render. Keep the listener stable and read the latest one
 * through a ref instead.
 */
function useLatest<T>(value: T) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

function useBooleanPrefSync(
  eventName: string,
  reload: () => boolean,
  set: (v: boolean) => void,
) {
  const reloadRef = useLatest(reload);
  const setRef = useLatest(set);
  useEffect(() => {
    const onChange = (ev: Event) => {
      const detail = (ev as CustomEvent<unknown>).detail;
      if (typeof detail === "boolean") {
        setRef.current(detail);
        return;
      }
      setRef.current(reloadRef.current());
    };
    window.addEventListener(eventName, onChange);
    return () => window.removeEventListener(eventName, onChange);
  }, [eventName, reloadRef, setRef]);
}

function useReloadPrefSync(eventName: string, reload: () => void) {
  const reloadRef = useLatest(reload);
  useEffect(() => {
    const onChange = () => reloadRef.current();
    window.addEventListener(eventName, onChange);
    return () => window.removeEventListener(eventName, onChange);
  }, [eventName, reloadRef]);
}

export function useWorkbenchDisplayPrefs() {
  const [showMessageTimestamps, setShowMessageTimestamps] = useState(() =>
    loadMessageTimestampsPref(localStorage),
  );
  const [showReplyLength, setShowReplyLength] = useState(() =>
    loadShowReplyLengthPref(localStorage),
  );
  const [replaceProviderBrandLogo, setReplaceProviderBrandLogo] = useState(
    () => loadReplaceProviderBrandLogoPref(localStorage),
  );
  const [goalOrchUiEnabled, setGoalOrchUiEnabled] = useState(() =>
    loadGoalOrchUiEnabled(localStorage),
  );
  const [goalOrchEvents, setGoalOrchEvents] = useState<GoalOrchEvent[]>([]);
  const [messageTimeFormat, setMessageTimeFormat] = useState<MessageTimeFormat>(
    () => loadMessageTimeFormatPref(localStorage),
  );
  const [sidebarShowRelativeTime, setSidebarShowRelativeTime] = useState(() =>
    loadSidebarShowRelativeTimePref(localStorage),
  );
  const [notifySound, setNotifySound] = useState(() =>
    loadNotifySoundPref(localStorage),
  );
  const [windowAlwaysOnTop, setWindowAlwaysOnTop] = useState(() =>
    loadWindowAlwaysOnTopPref(localStorage),
  );
  const [trayBusyBadge, setTrayBusyBadge] = useState(() =>
    loadTrayBusyBadgePref(localStorage),
  );
  const [composerSendKeyPref, setComposerSendKeyPref] =
    useState<ComposerSendKeyPref>(() => loadComposerSendKeyPref());
  const [showComposerDraftStats, setShowComposerDraftStats] = useState(() =>
    loadComposerDraftStatsPref(),
  );
  const [composerSpellcheck, setComposerSpellcheck] = useState(() =>
    loadComposerSpellcheck(),
  );
  const [sidebarDensity, setSidebarDensity] = useState<SidebarDensity>(() =>
    loadSidebarDensity(),
  );
  const [permissionTimeoutSec, setPermissionTimeoutSec] = useState(() =>
    loadPermissionTimeoutSec(localStorage),
  );
  const [askUserTimeoutSec, setAskUserTimeoutSec] = useState(() =>
    loadAskUserTimeoutSec(localStorage),
  );

  useBooleanPrefSync(
    MESSAGE_TIMESTAMPS_CHANGE_EVENT,
    () => loadMessageTimestampsPref(localStorage),
    setShowMessageTimestamps,
  );
  useBooleanPrefSync(
    SHOW_REPLY_LENGTH_CHANGE_EVENT,
    () => loadShowReplyLengthPref(localStorage),
    setShowReplyLength,
  );
  useBooleanPrefSync(
    REPLACE_PROVIDER_BRAND_LOGO_CHANGE_EVENT,
    () => loadReplaceProviderBrandLogoPref(localStorage),
    setReplaceProviderBrandLogo,
  );
  useBooleanPrefSync(
    NOTIFY_SOUND_CHANGE_EVENT,
    () => loadNotifySoundPref(localStorage),
    setNotifySound,
  );

  useEffect(() => {
    const onChange = (ev: Event) => {
      const detail = (ev as CustomEvent<unknown>).detail;
      if (detail === "absolute" || detail === "relative") {
        setMessageTimeFormat(detail);
        return;
      }
      setMessageTimeFormat(loadMessageTimeFormatPref(localStorage));
    };
    window.addEventListener(MESSAGE_TIME_FORMAT_CHANGE_EVENT, onChange);
    return () =>
      window.removeEventListener(MESSAGE_TIME_FORMAT_CHANGE_EVENT, onChange);
  }, []);

  useReloadPrefSync(SIDEBAR_SHOW_RELATIVE_TIME_CHANGE_EVENT, () =>
    setSidebarShowRelativeTime(loadSidebarShowRelativeTimePref(localStorage)),
  );
  useReloadPrefSync(COMPOSER_SEND_KEY_CHANGED_EVENT, () =>
    setComposerSendKeyPref(loadComposerSendKeyPref()),
  );
  useReloadPrefSync(COMPOSER_DRAFT_STATS_CHANGED_EVENT, () =>
    setShowComposerDraftStats(loadComposerDraftStatsPref()),
  );
  useReloadPrefSync(COMPOSER_SPELLCHECK_CHANGED_EVENT, () =>
    setComposerSpellcheck(loadComposerSpellcheck()),
  );
  useReloadPrefSync(SIDEBAR_DENSITY_EVENT, () =>
    setSidebarDensity(loadSidebarDensity()),
  );

  useEffect(() => {
    const onChange = (ev: Event) => {
      const detail = (ev as CustomEvent<unknown>).detail;
      if (typeof detail === "number" && Number.isFinite(detail)) {
        setPermissionTimeoutSec(detail);
        return;
      }
      setPermissionTimeoutSec(loadPermissionTimeoutSec(localStorage));
    };
    window.addEventListener(PERMISSION_TIMEOUT_CHANGE_EVENT, onChange);
    return () =>
      window.removeEventListener(PERMISSION_TIMEOUT_CHANGE_EVENT, onChange);
  }, []);

  useEffect(() => {
    const onChange = (ev: Event) => {
      const detail = (ev as CustomEvent<unknown>).detail;
      if (typeof detail === "number" && Number.isFinite(detail)) {
        setAskUserTimeoutSec(detail);
        return;
      }
      setAskUserTimeoutSec(loadAskUserTimeoutSec(localStorage));
    };
    window.addEventListener(ASK_USER_TIMEOUT_CHANGE_EVENT, onChange);
    return () =>
      window.removeEventListener(ASK_USER_TIMEOUT_CHANGE_EVENT, onChange);
  }, []);

  useEffect(() => {
    void applyWindowAlwaysOnTop(windowAlwaysOnTop);
  }, [windowAlwaysOnTop]);

  return {
    showMessageTimestamps,
    setShowMessageTimestamps,
    showReplyLength,
    setShowReplyLength,
    replaceProviderBrandLogo,
    setReplaceProviderBrandLogo,
    goalOrchUiEnabled,
    setGoalOrchUiEnabled,
    goalOrchEvents,
    setGoalOrchEvents,
    messageTimeFormat,
    setMessageTimeFormat,
    sidebarShowRelativeTime,
    setSidebarShowRelativeTime,
    notifySound,
    setNotifySound,
    windowAlwaysOnTop,
    setWindowAlwaysOnTop,
    trayBusyBadge,
    setTrayBusyBadge,
    composerSendKeyPref,
    setComposerSendKeyPref,
    showComposerDraftStats,
    setShowComposerDraftStats,
    composerSpellcheck,
    setComposerSpellcheck,
    sidebarDensity,
    setSidebarDensity,
    permissionTimeoutSec,
    setPermissionTimeoutSec,
    askUserTimeoutSec,
    setAskUserTimeoutSec,
  };
}
