import type { RefObject } from "react";
import { createT, type Locale } from "@/i18n";
import { IconClose, IconFolder, IconSearch, IconNewChat as IconSquarePen } from "@/components/icons";
import { OverlayScroll } from "@/components/OverlayScroll";
import { paletteActionIcon } from "@/app/paletteActionIcon";
import {
  normalizeSessionRow,
  type Project,
  type SessionRow,
} from "@/lib/app/sidebarModels";
import type { PaletteActionDef } from "@/lib/paletteActions";
import {
  SESSION_SEARCH_MODES,
  SESSION_SEARCH_RANK_MODES,
  sessionSearchBadge,
  sessionSearchBadgeLabelKey,
  sessionSearchModeLabelKey,
  sessionSearchRankModeLabelKey,
  shouldScanSessionContent,
  type MergedSessionHit,
  type SearchableProject,
  type SessionSearchEmptyPresentation,
  type SessionSearchMode,
  type SessionSearchRankMode,
} from "@/lib/sessionSearch";

export function SearchPalette(props: {
  locale: Locale;
  panelRef: RefObject<HTMLDivElement | null>;
  query: string;
  mode: SessionSearchMode;
  rankMode: SessionSearchRankMode;
  includeArchived: boolean;
  filtersActive: boolean;
  activeIndex: number;
  itemCount: number;
  actions: PaletteActionDef[];
  projects: SearchableProject[];
  sessionHits: MergedSessionHit[];
  sessions: SessionRow[];
  projectsCatalog: Project[];
  contentSearchLoading: boolean;
  emptyState: SessionSearchEmptyPresentation | null;
  settingsShortcutHint: string;
  onClose: () => void;
  onQueryChange: (value: string) => void;
  onModeChange: (mode: SessionSearchMode) => void;
  onRankModeChange: (mode: SessionSearchRankMode) => void;
  onIncludeArchivedChange: (value: boolean) => void;
  onClearFilters: () => void;
  onActiveIndexChange: (index: number) => void;
  onRunAction: (action: PaletteActionDef) => void;
  onPickProject: (project: SearchableProject) => void;
  onPickSession: (row: SessionRow, project: Project | null) => void;
}) {
  const tr = createT(props.locale);
  return (
    <div
      className="overlay"
      role="presentation"
      onClick={props.onClose}
    >
      <div
        ref={props.panelRef}
        className="search-panel"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={tr("search.title")}
      >
        <div className="search-panel__head">
          <IconSearch size={16} />
          <input
            autoFocus
            className="search-panel__input"
            placeholder={tr("search.placeholder")}
            value={props.query}
            onChange={(e) => props.onQueryChange(e.target.value)}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded="true"
            aria-controls="search-panel-listbox"
            aria-activedescendant={
              props.itemCount > 0
                ? `search-opt-${props.activeIndex}`
                : undefined
            }
          />
          <button
            type="button"
            className="icon-btn modal-close"
            onClick={props.onClose}
            aria-label={tr("common.close")}
          >
            <IconClose size={16} />
          </button>
        </div>
        <div className="search-panel__filters">
          <div
            className="search-panel__modes"
            role="tablist"
            aria-label={tr("search.modeLabel")}
          >
            {SESSION_SEARCH_MODES.map((mode) => (
              <button
                key={mode}
                type="button"
                role="tab"
                aria-selected={props.mode === mode}
                className={
                  "search-panel__mode" +
                  (props.mode === mode ? " is-active" : "")
                }
                onClick={() => props.onModeChange(mode)}
              >
                {tr(sessionSearchModeLabelKey(mode))}
              </button>
            ))}
          </div>
          <label className="search-panel__archived">
            <input
              type="checkbox"
              checked={props.includeArchived}
              onChange={(e) =>
                props.onIncludeArchivedChange(e.target.checked)
              }
            />
            <span>{tr("search.includeArchived")}</span>
          </label>
          {props.filtersActive ? (
            <button
              type="button"
              className="search-panel__clear-filters"
              onClick={props.onClearFilters}
            >
              {tr("search.clearFilters")}
            </button>
          ) : null}
        </div>
        <div className="search-panel__filters">
          <div
            className="search-panel__modes"
            role="tablist"
            aria-label={tr("search.rankModeLabel")}
          >
            {SESSION_SEARCH_RANK_MODES.map((mode) => (
              <button
                key={mode}
                type="button"
                role="tab"
                aria-selected={props.rankMode === mode}
                className={
                  "search-panel__mode" +
                  (props.rankMode === mode ? " is-active" : "")
                }
                onClick={() => props.onRankModeChange(mode)}
              >
                {tr(sessionSearchRankModeLabelKey(mode))}
              </button>
            ))}
          </div>
          <span className="search-panel__rank-hint">
            {props.rankMode === "hybrid"
              ? tr("search.rankHybridHint")
              : tr("search.rankKeywordHint")}
          </span>
        </div>
        <OverlayScroll className="search-panel__results">
          <div
            id="search-panel-listbox"
            role="listbox"
            aria-label={tr("search.title")}
          >
            {props.actions.length > 0 && (
              <>
                <div className="search-panel__section">
                  {tr("search.actions")}
                </div>
                {props.actions.map((action, i) => {
                  const idx = i;
                  const active = idx === props.activeIndex;
                  return (
                    <button
                      key={action.id}
                      type="button"
                      id={`search-opt-${idx}`}
                      data-search-idx={idx}
                      role="option"
                      aria-selected={active}
                      tabIndex={-1}
                      className={
                        "search-panel__row" + (active ? " is-active" : "")
                      }
                      onMouseEnter={() => props.onActiveIndexChange(idx)}
                      onClick={() => props.onRunAction(action)}
                    >
                      {paletteActionIcon(action.id)}
                      <span className="search-panel__title">
                        {tr(action.labelKey)}
                      </span>
                      {action.group === "settings" ? (
                        <kbd className="menu-shortcut" aria-hidden>
                          {props.settingsShortcutHint}
                        </kbd>
                      ) : null}
                    </button>
                  );
                })}
              </>
            )}
            {props.projects.length > 0 && (
              <>
                <div className="search-panel__section">
                  {tr("sidebar.projects")}
                </div>
                {props.projects.map((p, i) => {
                  const idx = props.actions.length + i;
                  const active = idx === props.activeIndex;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      id={`search-opt-${idx}`}
                      data-search-idx={idx}
                      role="option"
                      aria-selected={active}
                      tabIndex={-1}
                      className={
                        "search-panel__row" + (active ? " is-active" : "")
                      }
                      onMouseEnter={() => props.onActiveIndexChange(idx)}
                      onClick={() => props.onPickProject(p)}
                    >
                      <IconFolder size={15} />
                      <span className="search-panel__title">{p.name}</span>
                      <span className="search-panel__meta">{p.path}</span>
                    </button>
                  );
                })}
              </>
            )}
            <div className="search-panel__section">
              {tr("search.chats")}
              {props.contentSearchLoading &&
              shouldScanSessionContent(props.query, props.mode)
                ? ` · ${tr("search.searchingContent")}`
                : null}
            </div>
            {props.emptyState ? (
              <div
                className="search-panel__empty"
                role="status"
                data-kind={props.emptyState.kind}
              >
                <p className="search-panel__empty-title">
                  {tr(props.emptyState.titleKey)}
                </p>
                <p className="search-panel__empty-hint">
                  {tr(props.emptyState.hintKey)}
                </p>
                {props.emptyState.showClearFilters ? (
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm search-panel__empty-clear"
                    onClick={props.onClearFilters}
                  >
                    {tr("search.clearFilters")}
                  </button>
                ) : null}
              </div>
            ) : null}
            {props.sessionHits.map((hit, i) => {
              const s = props.sessions.find((x) => x.id === hit.id);
              const row: SessionRow =
                s ??
                normalizeSessionRow({
                  id: hit.id,
                  title: hit.title,
                  projectId: hit.projectId ?? null,
                  updatedAt: "",
                  archived: hit.archived,
                });
              const proj = props.projectsCatalog.find(
                (p) => p.id === (row.projectId ?? hit.projectId),
              );
              const badge = sessionSearchBadge(hit);
              const metaParts: string[] = [];
              if (proj?.name) metaParts.push(proj.name);
              if (hit.contentMatch && hit.matchCount && hit.matchCount > 0) {
                metaParts.push(
                  tr("search.matchCount", { n: String(hit.matchCount) }),
                );
              }
              if (i < 9) metaParts.push(`⌘${i + 1}`);
              const idx =
                props.actions.length + props.projects.length + i;
              const active = idx === props.activeIndex;
              return (
                <button
                  key={hit.id}
                  type="button"
                  id={`search-opt-${idx}`}
                  data-search-idx={idx}
                  role="option"
                  aria-selected={active}
                  tabIndex={-1}
                  className={
                    "search-panel__row" + (active ? " is-active" : "")
                  }
                  onMouseEnter={() => props.onActiveIndexChange(idx)}
                  onClick={() => props.onPickSession(row, proj ?? null)}
                >
                  <IconSquarePen size={15} />
                  <span className="search-panel__body">
                    <span className="search-panel__title">
                      <span className="search-panel__title-text">
                        {hit.title || s?.title || "Untitled"}
                      </span>
                      {badge ? (
                        <span
                          className={
                            "search-panel__badge" +
                            (badge === "content"
                              ? " search-panel__badge--content"
                              : badge === "both"
                                ? " search-panel__badge--both"
                                : "")
                          }
                        >
                          {tr(sessionSearchBadgeLabelKey(badge))}
                        </span>
                      ) : null}
                    </span>
                    {hit.snippet ? (
                      <span className="search-panel__snippet">
                        {hit.snippet}
                      </span>
                    ) : null}
                  </span>
                  <span className="search-panel__meta">
                    {metaParts.join(" · ") || "—"}
                  </span>
                </button>
              );
            })}
          </div>
        </OverlayScroll>
      </div>
    </div>
  );
}
