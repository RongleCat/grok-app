/**
 * Side Workbench — Find skills tab (right panel).
 * Live-ranks host `skills_list` against the composer draft; click inserts
 * `[[skill:name]]` via parent callback.
 */

import {
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { createT, type Locale } from "@/i18n";
import { IconSearch, IconSkills } from "@/components/icons";
import {
  getSnapshot,
  subscribe,
} from "@/lib/composerDraftStore";
import {
  filterPickerEligibleSkills,
  loadRecentSkillIds,
  rankSkillsForTask,
  recordRecentSkill,
  SKILLS_RECENT_CHANGE_EVENT,
  type SkillsPickerSkill,
} from "@/lib/skillsTaskPicker";
import type { SkillInfo } from "@/lib/slashCatalog";

export type SkillsTabProps = {
  locale: Locale | string;
  skills: readonly SkillInfo[];
  loading?: boolean;
  hostError?: string | null;
  onSelectSkill: (skill: SkillsPickerSkill) => void;
};

function toPicker(skills: readonly SkillInfo[]): SkillsPickerSkill[] {
  return skills.map((s) => ({
    name: s.name,
    description: s.description,
    source: s.source,
    userInvocable: s.userInvocable,
    enabled: s.enabled,
  }));
}

export function SkillsTab({
  locale,
  skills,
  loading = false,
  hostError = null,
  onSelectSkill,
}: SkillsTabProps) {
  const tr = useMemo(() => createT(locale as Locale), [locale]);
  const draft = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const [debouncedDraft, setDebouncedDraft] = useState(draft);
  const [query, setQuery] = useState("");
  const [recentIds, setRecentIds] = useState<string[]>(() =>
    loadRecentSkillIds(),
  );

  // Debounce harder than composer island — catalog can be 100s–1000s of skills.
  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedDraft(draft), 400);
    return () => window.clearTimeout(t);
  }, [draft]);

  useEffect(() => {
    const onRecent = () => setRecentIds(loadRecentSkillIds());
    window.addEventListener(SKILLS_RECENT_CHANGE_EVENT, onRecent);
    return () =>
      window.removeEventListener(SKILLS_RECENT_CHANGE_EVENT, onRecent);
  }, []);

  const catalog = useMemo(
    () => filterPickerEligibleSkills(toPicker(skills)),
    [skills],
  );

  const ranked = useMemo(
    () =>
      rankSkillsForTask({
        skills: catalog,
        recentIds,
        query,
        prompt: debouncedDraft,
        promptLimit: 60,
      }),
    [catalog, recentIds, query, debouncedDraft],
  );

  const promptMatchMode =
    debouncedDraft.trim().length >= 4 && !query.trim();
  const sectionTitle = promptMatchMode
    ? tr("skillsPicker.matched")
    : tr("skillsPicker.all");

  const handleSelect = (skill: SkillsPickerSkill) => {
    setRecentIds(recordRecentSkill(skill.name));
    onSelectSkill(skill);
  };

  return (
    <div className="sw-skills" data-testid="side-skills-tab">
      <div className="sw-skills__head">
        <div className="sw-skills__title-row">
          <IconSkills size={16} aria-hidden />
          <span className="sw-skills__title">{tr("side.tab.skills")}</span>
          <span className="sw-skills__count">
            {loading ? "…" : catalog.length}
          </span>
        </div>
        <p className="sw-skills__hint">{tr("side.skills.hint")}</p>
        <label className="sw-skills__filter">
          <IconSearch size={14} aria-hidden />
          <input
            type="search"
            value={query}
            placeholder={tr("skillsPicker.placeholder")}
            aria-label={tr("skillsPicker.placeholder")}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>

      <div className="sw-skills__section">{sectionTitle}</div>

      <div className="sw-skills__list" role="listbox" aria-label={tr("skillsPicker.aria")}>
        {loading && ranked.length === 0 ? (
          <div className="sw-skills__empty">{tr("skillsPicker.loading")}</div>
        ) : null}

        {!loading && hostError && catalog.length === 0 ? (
          <div className="sw-skills__empty">
            <div className="sw-skills__empty-title">
              {tr("skillsPicker.hostOnly")}
            </div>
            <div className="sw-skills__empty-hint">
              {tr("skillsPicker.hostOnlyHint")}
            </div>
            <div className="sw-skills__empty-error">{hostError}</div>
          </div>
        ) : null}

        {!loading && !hostError && catalog.length === 0 ? (
          <div className="sw-skills__empty">
            <div className="sw-skills__empty-title">
              {tr("skillsPicker.empty")}
            </div>
            <div className="sw-skills__empty-hint">
              {tr("skillsPicker.emptyHint")}
            </div>
          </div>
        ) : null}

        {!loading && catalog.length > 0 && ranked.length === 0 ? (
          <div className="sw-skills__empty">
            <div className="sw-skills__empty-title">
              {tr("skillsPicker.filterEmpty")}
            </div>
            <div className="sw-skills__empty-hint">
              {promptMatchMode
                ? tr("side.skills.noMatchHint")
                : tr("skillsPicker.filterEmptyHint")}
            </div>
            {query.trim() ? (
              <button
                type="button"
                className="btn btn--ghost sw-skills__clear"
                onClick={() => setQuery("")}
              >
                {tr("skillsPicker.clearFilter")}
              </button>
            ) : null}
          </div>
        ) : null}

        {ranked.map((s, i) => {
          const score = s.matchScore ?? 0;
          const top = promptMatchMode && i < 3 && score > 0;
          return (
            <button
              key={s.name}
              type="button"
              role="option"
              className={
                "sw-skills__item" +
                (top ? " sw-skills__item--top" : "") +
                (score > 0 ? " sw-skills__item--matched" : "")
              }
              onClick={() => handleSelect(s)}
              title={s.description || s.name}
            >
              <span className="sw-skills__item-ico" aria-hidden>
                <IconSkills size={15} />
              </span>
              <span className="sw-skills__item-main">
                <span className="sw-skills__item-name-row">
                  <span className="sw-skills__item-name">{s.name}</span>
                  {score > 0 ? (
                    <span className="sw-skills__score">{score}</span>
                  ) : null}
                </span>
                {s.description ? (
                  <span className="sw-skills__item-desc">{s.description}</span>
                ) : null}
                {s.matchedTokens && s.matchedTokens.length > 0 ? (
                  <span className="sw-skills__tokens">
                    {s.matchedTokens.slice(0, 5).map((t) => (
                      <span key={t} className="sw-skills__token">
                        {t}
                      </span>
                    ))}
                  </span>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
