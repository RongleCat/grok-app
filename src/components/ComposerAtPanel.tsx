/**
 * `@` file mention panel — same chrome as ComposerPlusPanel / slash menu.
 */

import { useEffect, useRef, type CSSProperties, type Ref } from "react";
import type { Locale } from "@/i18n";
import { createT } from "@/i18n";
import { IconCode, IconFileText, IconFolder } from "@/components/icons";
import type { AtFileHit } from "@/lib/atFileQuery";

const ICON_SIZE = 16;

export type ComposerAtFileEntry = AtFileHit & {
  /** Directory hint when known. */
  isDir?: boolean;
};

function fileIcon(name: string, isDir?: boolean) {
  if (isDir) return <IconFolder size={ICON_SIZE} />;
  const ext = name.includes(".") ? name.split(".").pop()?.toLowerCase() : "";
  if (
    ext &&
    ["ts", "tsx", "js", "jsx", "mjs", "cjs", "json", "rs", "go", "py", "css"].includes(
      ext,
    )
  ) {
    return <IconCode size={ICON_SIZE} />;
  }
  return <IconFileText size={ICON_SIZE} />;
}

export function ComposerAtPanel({
  open,
  panelRef,
  locale,
  entries,
  filterQuery,
  loading,
  softFail,
  activeIndex,
  onActiveIndexChange,
  onSelect,
  style,
}: {
  open: boolean;
  panelRef?: Ref<HTMLDivElement>;
  locale: Locale;
  entries: ComposerAtFileEntry[];
  filterQuery: string;
  loading?: boolean;
  softFail?: string | null;
  activeIndex: number;
  onActiveIndexChange: (i: number) => void;
  onSelect: (entry: ComposerAtFileEntry) => void;
  style?: CSSProperties;
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

  useEffect(() => {
    if (!open) return;
    const panel = listRef.current;
    if (!panel) return;
    const el = panel.querySelector<HTMLElement>(
      `[data-at-idx="${activeIndex}"]`,
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

  if (!open) return null;

  const q = (filterQuery ?? "").trim();
  const empty =
    !loading && entries.length === 0
      ? softFail === "no_project"
        ? {
            title: tr("composer.at.noProject"),
            hint: tr("composer.at.noProjectHint"),
          }
        : softFail === "untrusted_project"
          ? {
              title: tr("composer.at.untrusted"),
              hint: tr("composer.at.untrustedHint"),
            }
          : q
            ? {
                title: tr("composer.at.noMatches"),
                hint: tr("composer.at.noMatchesHint"),
              }
            : {
                title: tr("composer.at.empty"),
                hint: tr("composer.at.emptyHint"),
              }
      : null;

  return (
    <div
      ref={setRefs}
      className="menu-panel composer-plus composer-plus--portal composer-at"
      role="listbox"
      aria-label={tr("composer.at.aria")}
      aria-activedescendant={
        entries[activeIndex] ? `at-opt-${activeIndex}` : undefined
      }
      data-filter-query={q}
      style={style}
    >
      {q ? (
        <div className="composer-plus__filter" aria-live="polite">
          <span className="composer-plus__filter-label">@</span>
          <span className="composer-plus__filter-q">{q}</span>
          <span className="composer-plus__filter-count">{entries.length}</span>
        </div>
      ) : (
        <div className="composer-plus__filter" aria-live="polite">
          <span className="composer-plus__filter-label">@</span>
          <span className="composer-plus__filter-q composer-plus__filter-q--muted">
            {tr("composer.at.files")}
          </span>
          {loading ? (
            <span className="composer-plus__filter-count">
              {tr("composer.at.loading")}
            </span>
          ) : (
            <span className="composer-plus__filter-count">{entries.length}</span>
          )}
        </div>
      )}

      {empty ? (
        <div className="composer-plus__empty">
          <div className="composer-plus__title">{empty.title}</div>
          <div className="composer-plus__desc">{empty.hint}</div>
        </div>
      ) : (
        <div className="composer-plus__list" role="presentation">
          {entries.map((entry, i) => {
            const active = i === activeIndex;
            const parent =
              entry.relativePath.includes("/") ||
              entry.relativePath.includes("\\")
                ? entry.relativePath.replace(/[/\\][^/\\]+$/, "")
                : "";
            return (
              <button
                key={entry.path}
                type="button"
                id={`at-opt-${i}`}
                data-at-idx={i}
                role="option"
                aria-selected={active}
                className={
                  "composer-plus__item" + (active ? " is-active" : "")
                }
                onMouseEnter={() => onActiveIndexChange(i)}
                onClick={() => onSelect(entry)}
              >
                <span className="composer-plus__ico" aria-hidden>
                  {fileIcon(entry.name, entry.isDir)}
                </span>
                <span className="composer-plus__body">
                  {/*
                    文件名必须包在 __title-text 里：省略号（text-overflow）挂在
                    内层，外层 __title 是 overflow:hidden 的硬裁。少这一层时会
                    把 `vite.config.ts` 直接切掉尾巴且没有省略号，看起来像文件名
                    丢了几个字符。与 ComposerPlusPanel 的结构保持一致。
                  */}
                  <span
                    className={
                      // 没有目录描述时不要留 70% 上限：那时标题是整行唯一的内容，
                      // 上限只会白占宽度并截断本可完整显示的文件名。
                      "composer-plus__title" +
                      (parent ? "" : " composer-plus__title--solo")
                    }
                  >
                    <span className="composer-plus__title-text">
                      {entry.name}
                    </span>
                  </span>
                  {parent ? (
                    <span className="composer-plus__desc">{parent}</span>
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
