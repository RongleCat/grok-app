/**
 * Unified composer command panel (+ button and `/` slash).
 *
 * IMPORTANT: Render and keyboard nav share one `entries` array so they can
 * never desync (which caused “see many rows but only 2 keyboard targets”).
 */

import {
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type ReactNode,
  type Ref,
} from "react";
import type { Locale, MessageKey } from "@/i18n";
import { createT } from "@/i18n";
import { isProjectSkillSource } from "@/lib/extensionsUi";
import {
  countSlashByKind,
  resolveSlashMenuEmptyState,
  SLASH_KIND_FILTERS,
  slashKindLabelKey,
  type SlashItem,
  type SlashKindFilter,
  type SlashMenuEmptyPresentation,
} from "@/lib/slashCatalog";
import {
  IconActivity,
  IconArrowsMinimize,
  IconAttach,
  IconAutomations,
  IconBox,
  IconCircleDashed,
  IconClipboardList,
  IconCode,
  IconDoctor,
  IconNewChat,
  IconPlug,
  IconPuzzle,
  IconSettings,
  IconShieldCheck,
  IconSkills,
  IconTarget,
  IconLiveVoice,
  IconListTree,
} from "@/components/icons";

const ICON_SIZE = 16;

/** Selectable row (keyboard + click). */
export type ComposerPlusEntry =
  | { id: "upload"; kind: "upload" }
  | { id: "json-schema"; kind: "json-schema" }
  | { id: string; kind: "slash"; item: SlashItem };

/** Visual row including section headers (headers are not in keyboard nav). */
export type ComposerPlusRow =
  | { type: "section"; id: string; label: string }
  | { type: "entry"; entry: ComposerPlusEntry; navIndex: number };

function slashItemIcon(item: SlashItem): ReactNode {
  if (item.kind === "skill") {
    return <IconPuzzle size={ICON_SIZE} />;
  }
  const key = item.action ?? item.mode ?? item.name;
  switch (key) {
    case "goal":
      return <IconTarget size={ICON_SIZE} />;
    case "plan":
      return <IconClipboardList size={ICON_SIZE} />;
    case "compact":
      return <IconArrowsMinimize size={ICON_SIZE} />;
    case "status":
    case "usage":
    case "cost":
      return <IconActivity size={ICON_SIZE} />;
    case "mcp":
      return <IconPlug size={ICON_SIZE} />;
    case "doctor":
      return <IconDoctor size={ICON_SIZE} />;
    case "settings":
      return <IconSettings size={ICON_SIZE} />;
    case "automations":
      return <IconAutomations size={ICON_SIZE} />;
    case "workflow":
    case "workflows":
      return <IconListTree size={ICON_SIZE} />;
    case "live-voice":
    case "liveVoice":
      return <IconLiveVoice size={ICON_SIZE} />;
    case "newChat":
    case "new":
      return <IconNewChat size={ICON_SIZE} />;
    case "yolo":
    case "always-approve":
      return <IconShieldCheck size={ICON_SIZE} />;
    default:
      if (item.kind === "mode") return <IconCircleDashed size={ICON_SIZE} />;
      if (item.kind === "action") return <IconBox size={ICON_SIZE} />;
      return <IconSkills size={ICON_SIZE} />;
  }
}

/** Build keyboard-nav flat list: optional upload / json-schema + commands + skills. */
export function buildComposerPlusEntries(opts: {
  showUpload: boolean;
  /** Structured JSON Schema entry under the Add section. */
  showJsonSchema?: boolean;
  commands: SlashItem[];
  skills: SlashItem[];
}): ComposerPlusEntry[] {
  const out: ComposerPlusEntry[] = [];
  if (opts.showUpload) out.push({ id: "upload", kind: "upload" });
  if (opts.showJsonSchema) out.push({ id: "json-schema", kind: "json-schema" });
  for (const item of opts.commands) {
    out.push({ id: item.id, kind: "slash", item });
  }
  for (const item of opts.skills) {
    out.push({ id: item.id, kind: "slash", item });
  }
  return out;
}

/**
 * Rows for rendering: section headers + the same entries used for keyboard.
 * Order always: 添加 → 命令 (builtins like 目标/计划) → 技能.
 * Built-in commands must never sit under the skills section.
 */
export function buildComposerPlusRows(
  entries: ComposerPlusEntry[],
  labels: {
    add: string;
    commands: string;
    skills: string;
  },
): ComposerPlusRow[] {
  const rows: ComposerPlusRow[] = [];
  let navIndex = 0;
  let addedAddSection = false;
  let addedCmdSection = false;
  let addedSkillSection = false;

  for (const entry of entries) {
    if (entry.kind === "upload" || entry.kind === "json-schema") {
      if (!addedAddSection) {
        rows.push({ type: "section", id: "sec-add", label: labels.add });
        addedAddSection = true;
      }
      rows.push({ type: "entry", entry, navIndex: navIndex++ });
      continue;
    }

    if (entry.item.kind === "skill") {
      if (!addedSkillSection) {
        rows.push({ type: "section", id: "sec-skills", label: labels.skills });
        addedSkillSection = true;
      }
      rows.push({ type: "entry", entry, navIndex: navIndex++ });
      continue;
    }

    // mode / action / prompt → built-in commands (目标, 计划, …)
    if (!addedCmdSection) {
      rows.push({ type: "section", id: "sec-cmd", label: labels.commands });
      addedCmdSection = true;
    }
    rows.push({ type: "entry", entry, navIndex: navIndex++ });
  }
  return rows;
}

/** Whether the upload row matches a slash filter query. */
export function uploadMatchesQuery(
  query: string,
  labels: { title: string; hint: string },
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = [
    labels.title,
    labels.hint,
    "upload",
    "file",
    "files",
    "attach",
    "folder",
    "上传",
    "文件",
    "附件",
  ]
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

/** Whether the JSON Schema row matches a slash filter query. */
export function jsonSchemaMatchesQuery(
  query: string,
  labels: { title: string; hint: string },
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = [
    labels.title,
    labels.hint,
    "json",
    "schema",
    "structured",
    "json schema",
    "结构化",
  ]
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

export function ComposerPlusPanel({
  open,
  locale,
  style,
  panelRef,
  entries,
  filterQuery,
  kindFilter = "all",
  onKindFilterChange,
  catalogCount,
  kindCounts,
  skillsLoading,
  skillsError,
  skillCount,
  activeIndex,
  onActiveIndexChange,
  onSelectUpload,
  onSelectJsonSchema,
  onSelectSlash,
  onClearFilters,
  resolveTitle,
  resolveDescription,
}: {
  open: boolean;
  locale: Locale;
  style?: CSSProperties;
  panelRef?: Ref<HTMLDivElement | null>;
  /** Sole list of selectable items — same array the host uses for keyboard. */
  entries: ComposerPlusEntry[];
  /** Live filter string (shown in header when non-empty). */
  filterQuery?: string;
  /** Active kind chip (`all` when browsing full catalog). */
  kindFilter?: SlashKindFilter;
  /** Kind chip change — host refilters entries. */
  onKindFilterChange?: (kind: SlashKindFilter) => void;
  /**
   * Pre-filter slash catalog size (commands + skills).
   * Used for empty honesty; defaults to slash entries currently visible.
   */
  catalogCount?: number;
  /**
   * Pre-filter per-kind counts for chips. When omitted, derived from
   * visible slash entries (less accurate while filtering).
   */
  kindCounts?: ReturnType<typeof countSlashByKind>;
  skillsLoading?: boolean;
  /** Host skills_list error (CLI missing / inspect fail). */
  skillsError?: string | null;
  /** Number of invocable skills after enable filter (0 when empty catalog). */
  skillCount?: number;
  activeIndex: number;
  onActiveIndexChange: (i: number) => void;
  onSelectUpload: () => void;
  /** Optional: open structured JSON Schema modal. */
  onSelectJsonSchema?: () => void;
  onSelectSlash: (item: SlashItem) => void;
  /** Clear query (dismiss slash token) and/or reset kind chip. */
  onClearFilters?: () => void;
  resolveTitle: (item: SlashItem) => string;
  resolveDescription: (item: SlashItem) => string;
}) {
  const tr = createT(locale);
  const listRef = useRef<HTMLDivElement | null>(null);

  const setRefs = (node: HTMLDivElement | null) => {
    listRef.current = node;
    if (typeof panelRef === "function") panelRef(node);
    else if (panelRef && "current" in panelRef) {
      (panelRef as { current: HTMLDivElement | null }).current = node;
    }
  };

  const rows = buildComposerPlusRows(entries, {
    add: tr("composer.add"),
    commands: tr("slash.section.commands"),
    skills: tr("composer.skills"),
  });

  const slashEntries = useMemo(
    () => entries.filter((e): e is Extract<ComposerPlusEntry, { kind: "slash" }> => e.kind === "slash"),
    [entries],
  );

  const resolvedCatalogCount =
    catalogCount ??
    // Fallback: when host omits pre-filter size, use visible slash rows.
    slashEntries.length;

  const chipCounts = useMemo(() => {
    if (kindCounts) return kindCounts;
    return countSlashByKind(slashEntries.map((e) => e.item));
  }, [kindCounts, slashEntries]);

  const emptyState: SlashMenuEmptyPresentation | null = useMemo(
    () =>
      resolveSlashMenuEmptyState({
        loading: Boolean(skillsLoading) && resolvedCatalogCount === 0,
        catalogCount: resolvedCatalogCount,
        filteredCount: slashEntries.length,
        query: filterQuery ?? "",
        kind: kindFilter,
      }),
    [
      skillsLoading,
      resolvedCatalogCount,
      slashEntries.length,
      filterQuery,
      kindFilter,
    ],
  );

  // Full empty: no selectable rows (including upload) and empty honesty applies.
  const listEmpty =
    entries.length === 0 && !skillsLoading && emptyState != null;

  useEffect(() => {
    if (!open) return;
    const panel = listRef.current;
    if (!panel) return;
    const el = panel.querySelector<HTMLElement>(
      `[data-plus-idx="${activeIndex}"]`,
    );
    if (!el) return;
    const pRect = panel.getBoundingClientRect();
    const eRect = el.getBoundingClientRect();
    if (eRect.top < pRect.top) {
      panel.scrollTop -= pRect.top - eRect.top;
    } else if (eRect.bottom > pRect.bottom) {
      panel.scrollTop += eRect.bottom - pRect.bottom;
    }
  }, [activeIndex, open, entries.length]);

  const prevLen = useRef(entries.length);
  useEffect(() => {
    if (!open) return;
    if (prevLen.current === entries.length) return;
    prevLen.current = entries.length;
    const panel = listRef.current;
    if (panel) panel.scrollTop = 0;
  }, [entries.length, open]);

  if (!open) return null;

  const q = (filterQuery ?? "").trim();
  const showChips = Boolean(onKindFilterChange);

  return (
    <div
      ref={setRefs}
      className="menu-panel composer-plus composer-plus--portal"
      role="listbox"
      aria-activedescendant={
        entries[activeIndex] ? `plus-opt-${activeIndex}` : undefined
      }
      data-filter-query={q}
      data-kind-filter={kindFilter}
      style={style}
    >
      {q ? (
        <div className="composer-plus__filter" aria-live="polite">
          <span className="composer-plus__filter-label">/</span>
          <span className="composer-plus__filter-q">{q}</span>
          <span className="composer-plus__filter-count">
            {entries.length}
          </span>
        </div>
      ) : null}

      {showChips ? (
        <div
          className="composer-plus__chips"
          role="toolbar"
          aria-label={tr("slash.kindFilters")}
        >
          {SLASH_KIND_FILTERS.map((id) => {
            const n = chipCounts[id];
            // Hide zero-count chips except "all" and the active selection.
            if (id !== "all" && n === 0 && kindFilter !== id) return null;
            return (
              <button
                key={id}
                type="button"
                className={
                  "composer-plus__chip" +
                  (kindFilter === id ? " is-active" : "")
                }
                aria-pressed={kindFilter === id}
                onClick={() => onKindFilterChange?.(id)}
              >
                <span>{tr(slashKindLabelKey(id) as MessageKey)}</span>
                {id !== "all" ? (
                  <span className="composer-plus__chip-count">{n}</span>
                ) : (
                  <span className="composer-plus__chip-count">
                    {chipCounts.all}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      ) : null}

      {skillsLoading && entries.length === 0 && (
        <div
          className="composer-plus__item composer-plus__item--muted"
          aria-busy
        >
          <span className="composer-plus__ico" aria-hidden>
            <IconSkills size={ICON_SIZE} />
          </span>
          <span className="composer-plus__title">
            {tr("composer.skillsLoading")}
          </span>
        </div>
      )}

      {rows.map((row) => {
        if (row.type === "section") {
          return (
            <div key={row.id} className="composer-plus__section">
              {row.label}
            </div>
          );
        }
        const { entry, navIndex } = row;
        const active = navIndex === activeIndex;

        if (entry.kind === "upload") {
          return (
            <button
              key={`upload-${navIndex}`}
              id={`plus-opt-${navIndex}`}
              type="button"
              role="option"
              aria-selected={active}
              data-plus-idx={navIndex}
              className={
                "composer-plus__item" + (active ? " is-active" : "")
              }
              onMouseEnter={() => onActiveIndexChange(navIndex)}
              onClick={onSelectUpload}
            >
              <span className="composer-plus__ico" aria-hidden>
                <IconAttach size={ICON_SIZE} />
              </span>
              <span className="composer-plus__title">
                {tr("composer.addFiles")}
              </span>
              <span className="composer-plus__desc">
                {tr("composer.addFilesHint")}
              </span>
            </button>
          );
        }

        if (entry.kind === "json-schema") {
          return (
            <button
              key={`json-schema-${navIndex}`}
              id={`plus-opt-${navIndex}`}
              type="button"
              role="option"
              aria-selected={active}
              data-plus-idx={navIndex}
              className={
                "composer-plus__item" + (active ? " is-active" : "")
              }
              onMouseEnter={() => onActiveIndexChange(navIndex)}
              onClick={() => onSelectJsonSchema?.()}
            >
              <span className="composer-plus__ico" aria-hidden>
                <IconCode size={ICON_SIZE} />
              </span>
              <span className="composer-plus__title">
                {tr("composer.jsonSchema")}
              </span>
              <span className="composer-plus__desc">
                {tr("composer.jsonSchemaHint")}
              </span>
            </button>
          );
        }

        const item = entry.item;
        const title = resolveTitle(item);
        const desc = resolveDescription(item);
        const right =
          desc.trim() ||
          (item.kind === "skill" && item.source ? item.source : "") ||
          `/${item.name}`;

        return (
          <button
            key={`${entry.id}#${navIndex}`}
            id={`plus-opt-${navIndex}`}
            type="button"
            role="option"
            aria-selected={active}
            data-plus-idx={navIndex}
            className={
              "composer-plus__item" + (active ? " is-active" : "")
            }
            onMouseEnter={() => onActiveIndexChange(navIndex)}
            onClick={() => onSelectSlash(item)}
          >
            <span className="composer-plus__ico" aria-hidden>
              {slashItemIcon(item)}
            </span>
            <span className="composer-plus__title">
              <span className="composer-plus__title-text">{title}</span>
              {item.kind === "skill" && isProjectSkillSource(item.source) ? (
                <span
                  className="skill-scope-tag skill-scope-tag--project"
                  title={tr("ext.skills.badge.project")}
                >
                  [{tr("ext.skills.badge.project")}]
                </span>
              ) : null}
            </span>
            {right ? (
              <span className="composer-plus__desc">{right}</span>
            ) : null}
          </button>
        );
      })}

      {listEmpty && emptyState ? (
        <div
          className="composer-plus__empty"
          role="status"
          data-empty-kind={emptyState.kind}
        >
          <span className="composer-plus__title">
            {tr(emptyState.titleKey as MessageKey)}
          </span>
          {emptyState.hintKey ? (
            <span className="composer-plus__desc">
              {tr(emptyState.hintKey as MessageKey)}
            </span>
          ) : null}
          {emptyState.kind === "empty_catalog" && skillsError ? (
            <span className="composer-plus__desc" title={skillsError}>
              {skillsError}
            </span>
          ) : null}
          {emptyState.showClearFilters && onClearFilters ? (
            <button
              type="button"
              className="composer-plus__clear-filters"
              onClick={onClearFilters}
            >
              {tr("slash.clearFilters")}
            </button>
          ) : null}
        </div>
      ) : null}

      {/* Skills section empty hint when commands exist but no invocable skills */}
      {!listEmpty &&
      !skillsLoading &&
      !q &&
      kindFilter === "all" &&
      (skillCount ?? 0) === 0 &&
      !entries.some((e) => e.kind === "slash" && e.item.kind === "skill") ? (
        <div className="composer-plus__section">{tr("composer.skills")}</div>
      ) : null}
      {!listEmpty &&
      !skillsLoading &&
      !q &&
      kindFilter === "all" &&
      (skillCount ?? 0) === 0 &&
      !entries.some((e) => e.kind === "slash" && e.item.kind === "skill") ? (
        <div className="composer-plus__item composer-plus__item--muted">
          <span className="composer-plus__ico" aria-hidden>
            <IconSkills size={ICON_SIZE} />
          </span>
          <span className="composer-plus__title">
            {skillsError
              ? tr("composer.skillsLoadError")
              : tr("composer.skillsEmpty")}
          </span>
          {skillsError ? (
            <span className="composer-plus__desc" title={skillsError}>
              {skillsError}
            </span>
          ) : (
            <span className="composer-plus__desc">
              {tr("composer.skillsEmptyHint")}
            </span>
          )}
        </div>
      ) : null}
    </div>
  );
}
