/**
 * Shortcuts settings panel (filter, remap, conflicts).
 */
import {
  useEffect,
  useMemo,
  useState,
} from "react";
import { IconKeyboard, IconSearch } from "@/components/icons";
import { GlassModal } from "@/components/GlassModal";
import {
  SHORTCUTS,
  detectShortcutPlatform,
  filterShortcutGroups,
  shortcutScope,
  shortcutsByGroup,
  type ShortcutGroup,
  type ShortcutId,
  type ShortcutScope,
} from "@/lib/shortcuts";
import {
  SHORTCUT_IGNORE_CROSS_SCOPE_CHANGED_EVENT,
  SHORTCUT_IGNORE_CROSS_SCOPE_STORAGE_KEY,
  SHORTCUT_REMAP_CHANGED_EVENT,
  SHORTCUT_REMAP_STORAGE_KEY,
  buildEffectiveChordMap,
  chordFromKeyboardEvent,
  clearAllShortcutRemaps,
  findChordConflict,
  findChordConflicts,
  formatChordDisplay,
  hasAnyShortcutRemaps,
  isRemappableShortcutId,
  loadIgnoreCrossScopeConflicts,
  loadShortcutRemaps,
  planResetAllShortcutRemaps,
  resetConflictingShortcutRemaps,
  saveIgnoreCrossScopeConflicts,
  setShortcutRecordingActive,
  setShortcutRemap,
  summarizeChordConflicts,
  type ChordConflictOpts,
  type ShortcutRemapMap,
} from "@/lib/shortcutRemap";
import {
  COMPOSER_SEND_KEY_CHANGED_EVENT,
  loadComposerSendKeyPref,
  type ComposerSendKeyPref,
} from "@/lib/composerSendKey";
import {
  SHORTCUT_KEYS_OFF,
  VOICE_HOTKEY_CHANGED_EVENT,
  VOICE_HOTKEY_STORAGE_KEY,
  loadVoiceHotkeyEnabled,
} from "@/lib/voiceHotkeyPref";
import type { MessageKey, Vars } from "@/i18n";
import { UiCheck } from "./shared";

export function ShortcutsSettingsPanel({
  t,
  onOpenHelp,
}: {
  t: (key: MessageKey, vars?: Vars) => string;
  onOpenHelp?: () => void;
}) {
  const [filterQuery, setFilterQuery] = useState("");
  const platform = useMemo(() => detectShortcutPlatform(), []);
  /** Live send chord from Composer pref (same-tab + storage). */
  const [sendPref, setSendPref] = useState<ComposerSendKeyPref>(() =>
    loadComposerSendKeyPref(),
  );
  const [remaps, setRemaps] = useState<ShortcutRemapMap>(() =>
    loadShortcutRemaps(),
  );
  const [voiceHotkeyEnabled, setVoiceHotkeyEnabled] = useState(() =>
    loadVoiceHotkeyEnabled(),
  );
  const [ignoreCrossScope, setIgnoreCrossScope] = useState(() =>
    loadIgnoreCrossScopeConflicts(),
  );
  const [recordingId, setRecordingId] = useState<ShortcutId | null>(null);
  const [recordError, setRecordError] = useState<string | null>(null);
  /** GlassModal confirm for Reset all remaps (never window.confirm). */
  const [resetAllOpen, setResetAllOpen] = useState(false);

  const conflictOpts = useMemo<ChordConflictOpts>(
    () => ({
      ignoreCrossScope,
      scopeOf: shortcutScope,
    }),
    [ignoreCrossScope],
  );

  useEffect(() => {
    const reloadSend = () => setSendPref(loadComposerSendKeyPref());
    const reloadRemaps = () => setRemaps(loadShortcutRemaps());
    const reloadVoiceHotkey = () =>
      setVoiceHotkeyEnabled(loadVoiceHotkeyEnabled());
    const reloadIgnoreCross = () =>
      setIgnoreCrossScope(loadIgnoreCrossScopeConflicts());
    window.addEventListener(COMPOSER_SEND_KEY_CHANGED_EVENT, reloadSend);
    window.addEventListener(SHORTCUT_REMAP_CHANGED_EVENT, reloadRemaps);
    window.addEventListener(VOICE_HOTKEY_CHANGED_EVENT, reloadVoiceHotkey);
    window.addEventListener(
      SHORTCUT_IGNORE_CROSS_SCOPE_CHANGED_EVENT,
      reloadIgnoreCross,
    );
    const onStorage = (e: StorageEvent) => {
      if (e.key === "grok.composerSendKey" || e.key === null) reloadSend();
      if (e.key === SHORTCUT_REMAP_STORAGE_KEY || e.key === null) {
        reloadRemaps();
      }
      if (e.key === VOICE_HOTKEY_STORAGE_KEY || e.key === null) {
        reloadVoiceHotkey();
      }
      if (
        e.key === SHORTCUT_IGNORE_CROSS_SCOPE_STORAGE_KEY ||
        e.key === null
      ) {
        reloadIgnoreCross();
      }
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(COMPOSER_SEND_KEY_CHANGED_EVENT, reloadSend);
      window.removeEventListener(SHORTCUT_REMAP_CHANGED_EVENT, reloadRemaps);
      window.removeEventListener(VOICE_HOTKEY_CHANGED_EVENT, reloadVoiceHotkey);
      window.removeEventListener(
        SHORTCUT_IGNORE_CROSS_SCOPE_CHANGED_EVENT,
        reloadIgnoreCross,
      );
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  // Capture chord while recording; cancel with Escape.
  useEffect(() => {
    if (!recordingId) {
      setShortcutRecordingActive(false);
      return;
    }
    setShortcutRecordingActive(true);
    setRecordError(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      e.preventDefault();
      e.stopPropagation();
      // Escape cancels recording (does not bind Escape unless already escape chord via other path).
      if (e.key === "Escape") {
        setRecordingId(null);
        setRecordError(null);
        return;
      }
      const chord = chordFromKeyboardEvent(e);
      if (!chord) return;
      const effective = buildEffectiveChordMap(remaps);
      const conflict = findChordConflict(
        recordingId,
        chord,
        effective,
        conflictOpts,
      );
      if (conflict) {
        const conflictRow = SHORTCUTS.find((s) => s.id === conflict);
        const action = conflictRow
          ? t(conflictRow.labelKey as MessageKey)
          : conflict;
        setRecordError(
          t("settings.shortcuts.conflict", {
            action,
          }),
        );
        return;
      }
      const next = setShortcutRemap(recordingId, chord);
      setRemaps(next);
      setRecordingId(null);
      setRecordError(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      setShortcutRecordingActive(false);
    };
  }, [recordingId, remaps, t, conflictOpts]);

  const groups = useMemo(
    () => shortcutsByGroup(sendPref, remaps, voiceHotkeyEnabled),
    [sendPref, remaps, voiceHotkeyEnabled],
  );
  const filteredGroups = useMemo(
    () =>
      filterShortcutGroups(filterQuery, groups, (key) =>
        t(key as MessageKey),
      ),
    [filterQuery, groups, t],
  );

  const conflictGroups = useMemo(
    () => findChordConflicts(remaps, undefined, conflictOpts),
    [remaps, conflictOpts],
  );
  const conflictSummary = useMemo(
    () => summarizeChordConflicts(conflictGroups, remaps),
    [conflictGroups, remaps],
  );
  const conflictIdSet = useMemo(() => {
    const s = new Set<ShortcutId>();
    for (const g of conflictGroups) {
      for (const id of g.ids) s.add(id);
    }
    return s;
  }, [conflictGroups]);

  const resetAllPlan = useMemo(
    () => planResetAllShortcutRemaps(remaps),
    [remaps],
  );

  const shortcutLabel = (id: ShortcutId): string => {
    const row = SHORTCUTS.find((s) => s.id === id);
    return row ? t(row.labelKey as MessageKey) : id;
  };

  const scopeLabel = (scope: ShortcutScope) =>
    scope === "chat-focus"
      ? t("settings.shortcuts.scope.chatFocus")
      : t("settings.shortcuts.scope.global");

  const groupLabel = (g: ShortcutGroup) =>
    t(`settings.shortcuts.group.${g}` as MessageKey);

  const canResetAll = hasAnyShortcutRemaps(remaps) && resetAllPlan.hasAny;

  const startRecord = (id: ShortcutId) => {
    if (!isRemappableShortcutId(id)) return;
    setRecordError(null);
    setRecordingId((cur) => (cur === id ? null : id));
  };

  const resetOne = (id: ShortcutId) => {
    if (!isRemappableShortcutId(id)) return;
    setRemaps(setShortcutRemap(id, null));
    if (recordingId === id) setRecordingId(null);
    setRecordError(null);
  };

  const confirmResetAll = () => {
    setRemaps(clearAllShortcutRemaps());
    setRecordingId(null);
    setRecordError(null);
    setResetAllOpen(false);
  };

  const resetConflicting = () => {
    setRemaps(resetConflictingShortcutRemaps(remaps, localStorage, conflictOpts));
    setRecordingId(null);
    setRecordError(null);
  };

  return (
    <div className="settings-card">
      <div className="settings-row settings-row--stack">
        <div className="settings-row__text">
          <div className="settings-row__label">
            <IconKeyboard size={16} />
            {t("settings.shortcuts.title")}
          </div>
          <div className="settings-row__desc">{t("settings.shortcuts.desc")}</div>
        </div>
        <div className="settings-shortcuts-header-actions">
          {onOpenHelp ? (
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => onOpenHelp()}
            >
              {t("settings.shortcuts.openHelp")}
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn--ghost"
            disabled={!canResetAll || !!recordingId}
            onClick={() => setResetAllOpen(true)}
          >
            {t("settings.shortcuts.resetAll")}
            {canResetAll ? (
              <span className="settings-shortcuts-reset-count">
                {t("settings.shortcuts.customCount", {
                  n: resetAllPlan.count,
                })}
              </span>
            ) : null}
          </button>
        </div>
      </div>
      <div className="settings-row settings-shortcuts-scope-pref">
        <div className="settings-row__text">
          <div className="settings-row__label">
            {t("settings.shortcuts.ignoreCrossScope")}
          </div>
          <div className="settings-row__desc">
            {t("settings.shortcuts.ignoreCrossScopeDesc")}
          </div>
        </div>
        <UiCheck
          checked={ignoreCrossScope}
          onChange={() => {
            const next = !ignoreCrossScope;
            setIgnoreCrossScope(next);
            saveIgnoreCrossScopeConflicts(next);
          }}
          ariaLabel={t("settings.shortcuts.ignoreCrossScope")}
        />
      </div>
      <div className="settings-shortcuts-filter">
        <IconSearch size={14} />
        <input
          type="search"
          value={filterQuery}
          onChange={(e) => setFilterQuery(e.target.value)}
          placeholder={t("settings.shortcuts.filterPlaceholder")}
          aria-label={t("settings.shortcuts.filterPlaceholder")}
          disabled={!!recordingId}
        />
      </div>
      {conflictGroups.length > 0 ? (
        <div
          className="settings-shortcuts-conflicts"
          role="region"
          aria-label={t("settings.shortcuts.conflictsTitle")}
        >
          <div className="settings-shortcuts-conflicts__header">
            <div className="settings-shortcuts-conflicts__text">
              <div className="settings-shortcuts-conflicts__title">
                {t("settings.shortcuts.conflictsTitle")}
                <span className="settings-shortcuts-conflicts__badge">
                  {t("settings.shortcuts.conflictsSummary", {
                    groups: conflictSummary.groupCount,
                    actions: conflictSummary.idCount,
                  })}
                </span>
              </div>
              <div className="settings-shortcuts-conflicts__desc">
                {t("settings.shortcuts.conflictsDesc")}
                {conflictSummary.remappedCount > 0
                  ? ` ${t("settings.shortcuts.conflictsRemappedHint", {
                      n: conflictSummary.remappedCount,
                    })}`
                  : null}
              </div>
            </div>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              disabled={!!recordingId || conflictSummary.remappedCount === 0}
              onClick={() => resetConflicting()}
            >
              {t("settings.shortcuts.conflictsReset")}
            </button>
          </div>
          <ul className="settings-shortcuts-conflicts__list">
            {conflictGroups.map((group) => (
              <li
                key={`${group.chord}:${group.ids.join(",")}`}
                className="settings-shortcuts-conflicts__item"
              >
                <kbd className="settings-shortcuts-kbd is-conflict">
                  {formatChordDisplay(
                    group.chord,
                    platform === "mac" ? "mac" : "win",
                  )}
                </kbd>
                <span className="settings-shortcuts-conflicts__actions">
                  {group.ids.map((id) => shortcutLabel(id)).join(" · ")}
                </span>
                <span className="settings-shortcuts-conflicts__meta">
                  {t("settings.shortcuts.conflictsGroupMeta", {
                    n: group.ids.length,
                  })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {recordError ? (
        <p className="settings-shortcuts-error" role="alert">
          {recordError}
        </p>
      ) : recordingId ? (
        <p className="settings-shortcuts-recording-hint" role="status">
          {t("settings.shortcuts.recordingHint")}
        </p>
      ) : null}
      {filteredGroups.length === 0 ? (
        <p className="settings-shortcuts-empty" role="status">
          {t("settings.shortcuts.filterEmpty")}
        </p>
      ) : (
        filteredGroups.map(({ group, rows }) => (
          <div key={group} className="settings-shortcuts-group">
            <div className="settings-shortcuts-group__title">
              {groupLabel(group)}
            </div>
            <table className="settings-shortcuts-table">
              <thead>
                <tr>
                  <th scope="col">{t("settings.shortcuts.colAction")}</th>
                  <th scope="col">{t("settings.shortcuts.colScope")}</th>
                  <th
                    scope="col"
                    className={
                      platform === "mac" ? "is-platform-active" : undefined
                    }
                  >
                    {t("settings.shortcuts.colMac")}
                  </th>
                  <th
                    scope="col"
                    className={
                      platform === "win" || platform === "other"
                        ? "is-platform-active"
                        : undefined
                    }
                  >
                    {t("settings.shortcuts.colWin")}
                  </th>
                  <th scope="col" className="settings-shortcuts-col-actions">
                    {t("settings.shortcuts.colEdit")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const remappable = isRemappableShortcutId(row.id);
                  const isCustom = remappable && !!remaps[row.id];
                  const isRecording = recordingId === row.id;
                  const isConflict = conflictIdSet.has(row.id);
                  const rowClass = [
                    isRecording ? "settings-shortcuts-row--recording" : "",
                    isCustom ? "settings-shortcuts-row--custom" : "",
                    isConflict ? "settings-shortcuts-row--conflict" : "",
                  ]
                    .filter(Boolean)
                    .join(" ");
                  return (
                    <tr
                      key={row.id}
                      className={rowClass || undefined}
                    >
                      <td>
                        {t(row.labelKey as MessageKey)}
                        {isCustom ? (
                          <span className="settings-shortcuts-custom-dot" title={t("settings.shortcuts.customBadge")}>
                            ·
                          </span>
                        ) : null}
                      </td>
                      <td>
                        <span
                          className={
                            "settings-shortcuts-scope" +
                            (row.scope === "chat-focus"
                              ? " settings-shortcuts-scope--chat"
                              : " settings-shortcuts-scope--global")
                          }
                          title={
                            row.scope === "chat-focus"
                              ? t("settings.shortcuts.scope.chatFocusHint")
                              : t("settings.shortcuts.scope.globalHint")
                          }
                        >
                          {scopeLabel(row.scope)}
                        </span>
                      </td>
                      <td>
                        <kbd
                          className={
                            "settings-shortcuts-kbd" +
                            (isRecording ? " is-recording" : "") +
                            (isConflict && !isRecording ? " is-conflict" : "")
                          }
                        >
                          {isRecording
                            ? t("settings.shortcuts.pressKeys")
                            : row.mac === SHORTCUT_KEYS_OFF
                              ? t("shortcuts.off")
                              : row.mac}
                        </kbd>
                      </td>
                      <td>
                        <kbd
                          className={
                            "settings-shortcuts-kbd" +
                            (isRecording ? " is-recording" : "") +
                            (isConflict && !isRecording ? " is-conflict" : "")
                          }
                        >
                          {isRecording
                            ? t("settings.shortcuts.pressKeys")
                            : row.win === SHORTCUT_KEYS_OFF
                              ? t("shortcuts.off")
                              : row.win}
                        </kbd>
                      </td>
                      <td className="settings-shortcuts-col-actions">
                        <div className="settings-shortcuts-actions">
                          {remappable ? (
                            <>
                              <button
                                type="button"
                                className="btn btn--ghost btn--sm"
                                aria-pressed={isRecording}
                                onClick={() => startRecord(row.id)}
                              >
                                {isRecording
                                  ? t("settings.shortcuts.cancelRecord")
                                  : t("settings.shortcuts.record")}
                              </button>
                              <button
                                type="button"
                                className="btn btn--ghost btn--sm"
                                disabled={!isCustom || isRecording}
                                onClick={() => resetOne(row.id)}
                              >
                                {t("settings.shortcuts.reset")}
                              </button>
                            </>
                          ) : (
                            <span className="settings-shortcuts-fixed">
                              {row.id === "send" || row.id === "newline"
                                ? t("settings.shortcuts.fixedSend")
                                : t("settings.shortcuts.fixed")}
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))
      )}
      <p className="settings-shortcuts-note">{t("settings.shortcuts.note")}</p>

      <GlassModal
        open={resetAllOpen}
        onClose={() => setResetAllOpen(false)}
        title={t("settings.shortcuts.resetAllTitle")}
        size="sm"
        closeLabel={t("common.close")}
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setResetAllOpen(false)}
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn--danger"
              disabled={!resetAllPlan.hasAny}
              onClick={() => confirmResetAll()}
            >
              {t("settings.shortcuts.resetAllConfirm")}
            </button>
          </>
        }
      >
        <p className="settings-row__desc is-flush">
          {t("settings.shortcuts.resetAllMsg", { n: resetAllPlan.count })}
        </p>
      </GlassModal>
    </div>
  );
}

