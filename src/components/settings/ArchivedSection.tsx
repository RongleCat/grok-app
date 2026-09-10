/**
 * Settings → archived section (consumes SettingsModel context).
 */
import { useSettingsModel } from "@/providers/SettingsModelContext";

import { IconArchive, IconTrash } from "@/components/icons";
import { UiCheck, marqueeClientRect } from "./shared";


export function ArchivedSection() {
  const s = useSettingsModel();
  const {
    archiveAgeAnyMatch,
    archiveAgeMaxMatch,
    archiveAgePreviews,
    archivedAllSelected,
    archivedGroups = [],
    archivedSelected,
    archivedSelectedCount,
    archivedSomeSelected,
    archivedSurfaceRef,
    archivedTotal,
    formatSessionWhen,
    locale,
    marquee,
    onArchiveOlderThan,
    onArchivedPointerCancel,
    onArchivedPointerDown,
    onArchivedPointerMove,
    onArchivedPointerUp,
    onDeleteArchivedSessions,
    onRestoreArchivedSessions,
    setArchivedSelected,
    t,
    toggleArchivedAll,
    toggleArchivedGroup,
    toggleArchivedId,
  } = s;

  return (
    <>
<div id="settings-anchor-archived">
            <p className="settings-page__lead">
              {t("settings.archived.desc")}
            </p>
            {onArchiveOlderThan ? (
              <div
                className="settings-card settings-archived-age"
                id="settings-anchor-archive-older"
              >
                <div className="settings-row settings-row--stack">
                  <div className="settings-row__meta">
                    <div className="settings-row__label">
                      {t("settings.archived.archiveOlder")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.archived.archiveOlderDesc")}
                    </div>
                  </div>
                  <div
                    className="settings-archived-age__actions"
                    role="group"
                    aria-label={t("settings.archived.archiveOlder")}
                  >
                    {archiveAgePreviews.map(({ days, count }: { days: number; count: number }) => (
                      <button
                        key={days}
                        type="button"
                        className={
                          "btn btn--ghost btn--sm" +
                          (count === 0
                            ? " settings-archived-age__btn--empty"
                            : "")
                        }
                        onClick={() => onArchiveOlderThan(days)}
                        data-count={count}
                      >
                        {count > 0
                          ? t("settings.archived.archiveOlderDaysCount", {
                              days: String(days),
                              n: String(count),
                            })
                          : t("settings.archived.archiveOlderDays", {
                              days: String(days),
                            })}
                      </button>
                    ))}
                  </div>
                  <div
                    className={
                      "settings-archived-age__hint" +
                      (archiveAgeAnyMatch
                        ? ""
                        : " settings-archived-age__hint--empty")
                    }
                    role="status"
                  >
                    {archiveAgeAnyMatch
                      ? t("settings.archived.archiveOlderMatchHint", {
                          n: String(archiveAgeMaxMatch),
                        })
                      : t("settings.archived.archiveOlderNoneHint")}
                  </div>
                </div>
              </div>
            ) : null}
            {archivedTotal === 0 ? (
              <div className="settings-card">
                <div className="settings-archived-empty">
                  {t("settings.archived.empty")}
                </div>
              </div>
            ) : (
              <>
                <div className="settings-archived-toolbar">
                  <UiCheck
                    className="ui-check--all"
                    checked={archivedAllSelected}
                    indeterminate={archivedSomeSelected}
                    onChange={toggleArchivedAll}
                    ariaLabel={t("settings.archived.selectAll")}
                    label={
                      archivedAllSelected
                        ? t("settings.archived.deselectAll")
                        : t("settings.archived.selectAll")
                    }
                  />
                  <span className="settings-archived-toolbar__count">
                    {archivedSelectedCount > 0
                      ? t("settings.archived.selectedCount", {
                          n: archivedSelectedCount,
                        })
                      : t("settings.archived.totalCount", {
                          n: archivedTotal,
                        })}
                  </span>
                  <div className="settings-archived-toolbar__actions">
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      disabled={archivedSelectedCount === 0}
                      onClick={() => {
                        const ids = [...archivedSelected];
                        if (!ids.length) return;
                        onRestoreArchivedSessions?.(ids);
                        setArchivedSelected(new Set());
                      }}
                    >
                      {t("settings.archived.restore")}
                    </button>
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm btn--danger"
                      disabled={archivedSelectedCount === 0}
                      onClick={() => {
                        const ids = [...archivedSelected];
                        if (!ids.length) return;
                        onDeleteArchivedSessions?.(ids);
                      }}
                    >
                      <IconTrash size={14} />
                      {t("settings.archived.delete")}
                    </button>
                  </div>
                </div>
                <div
                  ref={archivedSurfaceRef}
                  className={
                    "settings-archived-surface" +
                    (marquee ? " is-marqueeing" : "")
                  }
                  onPointerDown={onArchivedPointerDown}
                  onPointerMove={onArchivedPointerMove}
                  onPointerUp={onArchivedPointerUp}
                  onPointerCancel={onArchivedPointerCancel}
                >
                  {marquee
                    ? (() => {
                        const r = marqueeClientRect(marquee);
                        if (r.width < 2 && r.height < 2) return null;
                        return (
                          <div
                            className="settings-archived-marquee"
                            style={{
                              left: r.left,
                              top: r.top,
                              width: r.width,
                              height: r.height,
                            }}
                            aria-hidden
                          />
                        );
                      })()
                    : null}
                  {archivedGroups.map((group) => {
                    const groupIds = group.sessions.map((s) => s.id);
                    const groupAll =
                      groupIds.length > 0 &&
                      groupIds.every((id) => archivedSelected.has(id));
                    const groupSome =
                      !groupAll &&
                      groupIds.some((id) => archivedSelected.has(id));
                    return (
                      <div
                        key={group.id ?? "__orphan__"}
                        className="settings-archived-group"
                      >
                        <h2 className="settings-page__h2">
                          <UiCheck
                            className="ui-check--group"
                            checked={groupAll}
                            indeterminate={groupSome}
                            onChange={() => toggleArchivedGroup(groupIds)}
                            ariaLabel={group.name}
                          />
                          <IconArchive size={15} />
                          <span>{group.name}</span>
                          <span className="settings-archived-group__count">
                            {group.sessions.length}
                          </span>
                        </h2>
                        <div className="settings-card settings-card--flush">
                          {group.sessions.map((s) => {
                            const selected = archivedSelected.has(s.id);
                            return (
                              <div
                                key={s.id}
                                data-archived-id={s.id}
                                className={
                                  "settings-archived-row" +
                                  (selected ? " is-selected" : "")
                                }
                              >
                                <UiCheck
                                  checked={selected}
                                  onChange={() => toggleArchivedId(s.id)}
                                  ariaLabel={
                                    s.title || t("session.untitled")
                                  }
                                />
                                <div className="settings-archived-row__text">
                                  <div className="settings-archived-row__title">
                                    {s.title || t("session.untitled")}
                                  </div>
                                  <div className="settings-archived-row__meta">
                                    {formatSessionWhen(s.updatedAt, locale)}
                                  </div>
                                </div>
                                <div className="settings-archived-row__actions">
                                  <button
                                    type="button"
                                    className="btn btn--ghost btn--sm"
                                    onClick={() =>
                                      onRestoreArchivedSessions?.([s.id])
                                    }
                                  >
                                    {t("settings.archived.restore")}
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn--ghost btn--sm btn--danger"
                                    onClick={() =>
                                      onDeleteArchivedSessions?.([s.id])
                                    }
                                  >
                                    <IconTrash size={14} />
                                    {t("settings.archived.delete")}
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
    </>
  );
}
