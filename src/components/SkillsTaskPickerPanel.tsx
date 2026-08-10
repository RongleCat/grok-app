/**
 * Composer task-level skills picker.
 * Search + recent chips + host catalog list. Never invents skill rows.
 * Click / Enter inserts `[[skill:name]]` via parent `onSelect`.
 */

import {
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type KeyboardEvent,
  type Ref,
} from "react";
import { IconPuzzle, IconSearch, IconSkills } from "@/components/icons";
import {
  recentSkillChips,
  resolveSkillsPickerEmptyState,
  type SkillsPickerSkill,
} from "@/lib/skillsTaskPicker";

export type SkillsTaskPickerLabels = {
  aria: string;
  placeholder: string;
  recent: string;
  all: string;
  /** When ranking from live prompt (matched hits). */
  matched?: string;
  loading: string;
  empty: string;
  emptyHint: string;
  filterEmpty: string;
  filterEmptyHint: string;
  hostOnly: string;
  hostOnlyHint: string;
  clearFilter: string;
};

export type SkillsTaskPickerPanelProps = {
  open: boolean;
  /** Eligible host skills (enabled + invocable). */
  skills: readonly SkillsPickerSkill[];
  /** Ranked list for the body (already filtered + ordered). */
  ranked: readonly SkillsPickerSkill[];
  /** Recent skill ids (newest first). */
  recentIds: readonly string[];
  query: string;
  activeIndex: number;
  loading?: boolean;
  hostError?: string | null;
  /** Eligible catalog size before query (for empty honesty). */
  catalogCount: number;
  focusFilter?: boolean;
  /**
   * When true, list is ranked from live composer prompt (show match scores).
   * Section title uses labels.matched.
   */
  promptMatchMode?: boolean;
  labels: SkillsTaskPickerLabels;
  onQueryChange: (q: string) => void;
  onActiveIndexChange: (i: number) => void;
  onSelect: (skill: SkillsPickerSkill) => void;
  onClearFilter?: () => void;
  style?: CSSProperties;
  panelRef?: Ref<HTMLDivElement | null>;
};

export function SkillsTaskPickerPanel({
  open,
  skills,
  ranked,
  recentIds,
  query,
  activeIndex,
  loading = false,
  hostError = null,
  catalogCount,
  focusFilter = true,
  promptMatchMode = false,
  labels,
  onQueryChange,
  onActiveIndexChange,
  onSelect,
  onClearFilter,
  style,
  panelRef,
}: SkillsTaskPickerPanelProps) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const filterRef = useRef<HTMLInputElement | null>(null);

  const setRefs = (node: HTMLDivElement | null) => {
    listRef.current = node;
    if (typeof panelRef === "function") panelRef(node);
    else if (panelRef && "current" in panelRef) {
      (panelRef as { current: HTMLDivElement | null }).current = node;
    }
  };

  const chips = useMemo(
    () =>
      recentSkillChips({
        skills,
        recentIds,
        limit: 8,
      }),
    [skills, recentIds],
  );

  const emptyState = useMemo(
    () =>
      resolveSkillsPickerEmptyState({
        catalogCount,
        filteredCount: ranked.length,
        query,
        hostError,
        loading,
      }),
    [catalogCount, ranked.length, query, hostError, loading],
  );

  useEffect(() => {
    if (!open || !focusFilter) return;
    const t = window.setTimeout(() => {
      filterRef.current?.focus();
      filterRef.current?.select();
    }, 0);
    return () => window.clearTimeout(t);
  }, [open, focusFilter]);

  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-skills-idx="${activeIndex}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open, ranked.length]);

  if (!open) return null;

  const q = query.trim();
  const showRecent = chips.length > 0 && !q && !promptMatchMode;
  const sectionTitle =
    promptMatchMode && ranked.some((s) => (s.matchScore ?? 0) > 0)
      ? labels.matched || labels.all
      : labels.all;
  const emptyTitle = emptyState
    ? emptyState.kind === "filter"
      ? labels.filterEmpty
      : emptyState.kind === "host_only"
        ? labels.hostOnly
        : labels.empty
    : "";
  const emptyHint = emptyState
    ? emptyState.kind === "filter"
      ? labels.filterEmptyHint
      : emptyState.kind === "host_only"
        ? labels.hostOnlyHint
        : labels.emptyHint
    : "";

  const onFilterKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (ranked.length === 0) return;
      onActiveIndexChange(Math.min(activeIndex + 1, ranked.length - 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (ranked.length === 0) return;
      onActiveIndexChange(Math.max(activeIndex - 1, 0));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const hit = ranked[activeIndex];
      if (hit) onSelect(hit);
      return;
    }
    if (e.key === "Home" && ranked.length > 0) {
      e.preventDefault();
      onActiveIndexChange(0);
      return;
    }
    if (e.key === "End" && ranked.length > 0) {
      e.preventDefault();
      onActiveIndexChange(ranked.length - 1);
    }
  };

  return (
    <div
      ref={setRefs}
      className="menu-panel skills-task-picker"
      role="listbox"
      aria-label={labels.aria}
      aria-activedescendant={
        ranked[activeIndex] ? `skills-opt-${activeIndex}` : undefined
      }
      style={style}
      data-testid="skills-task-picker"
      data-filter-query={q}
    >
      <div className="skills-task-picker__filter">
        <span className="skills-task-picker__filter-ico" aria-hidden>
          <IconSearch size={14} />
        </span>
        <input
          ref={filterRef}
          type="search"
          className="skills-task-picker__input"
          value={query}
          placeholder={labels.placeholder}
          aria-label={labels.placeholder}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={onFilterKeyDown}
        />
      </div>

      {showRecent ? (
        <div className="skills-task-picker__recent" aria-label={labels.recent}>
          <div className="skills-task-picker__section">{labels.recent}</div>
          <div className="skills-task-picker__chips">
            {chips.map((s) => (
              <button
                key={`recent-${s.name}`}
                type="button"
                className="skills-task-picker__chip"
                onClick={() => onSelect(s)}
              >
                <IconPuzzle size={12} aria-hidden />
                <span>{s.name}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="skills-task-picker__section">{sectionTitle}</div>

      <div className="skills-task-picker__list" role="presentation">
        {loading && ranked.length === 0 && !emptyState ? (
          <div
            className="skills-task-picker__empty"
            aria-busy
            data-empty-kind="loading"
          >
            {labels.loading}
          </div>
        ) : null}

        {emptyState ? (
          <div
            className="skills-task-picker__empty"
            data-empty-kind={emptyState.kind}
          >
            <div className="skills-task-picker__empty-title">{emptyTitle}</div>
            {emptyHint ? (
              <div className="skills-task-picker__empty-hint">{emptyHint}</div>
            ) : null}
            {hostError && emptyState.kind === "host_only" ? (
              <div className="skills-task-picker__empty-error">{hostError}</div>
            ) : null}
            {emptyState.showClearFilter && onClearFilter ? (
              <button
                type="button"
                className="btn btn--ghost skills-task-picker__clear-filter"
                onClick={onClearFilter}
              >
                {labels.clearFilter}
              </button>
            ) : null}
          </div>
        ) : (
          ranked.map((s, i) => {
            const active = i === activeIndex;
            const score = s.matchScore ?? 0;
            const top = promptMatchMode && i < 3 && score > 0;
            return (
              <button
                key={s.name}
                id={`skills-opt-${i}`}
                type="button"
                role="option"
                aria-selected={active}
                data-skills-idx={i}
                data-match-score={score > 0 ? score : undefined}
                className={
                  "skills-task-picker__item" +
                  (active ? " is-active" : "") +
                  (top ? " skills-task-picker__item--top" : "") +
                  (score > 0 ? " skills-task-picker__item--matched" : "")
                }
                onMouseEnter={() => onActiveIndexChange(i)}
                onClick={() => onSelect(s)}
              >
                <span className="skills-task-picker__ico" aria-hidden>
                  <IconSkills size={16} />
                </span>
                <span className="skills-task-picker__item-main">
                  <span className="skills-task-picker__item-name-row">
                    <span className="skills-task-picker__item-name">
                      {s.name}
                    </span>
                    {score > 0 ? (
                      <span className="skills-task-picker__score">{score}</span>
                    ) : null}
                  </span>
                  {s.description ? (
                    <span className="skills-task-picker__item-desc">
                      {s.description}
                    </span>
                  ) : null}
                  {s.matchedTokens && s.matchedTokens.length > 0 ? (
                    <span className="skills-task-picker__tokens">
                      {s.matchedTokens.slice(0, 6).map((t) => (
                        <span key={t} className="skills-task-picker__token">
                          {t}
                        </span>
                      ))}
                    </span>
                  ) : null}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
